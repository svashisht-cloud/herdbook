"""Ingest + API: MQTT subscriber, REST and a WebSocket in one FastAPI service.

REST endpoints are plain `def`, so their blocking DB calls run in FastAPI's
thread pool. The WebSocket hub lives on the event loop only.
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

import boto3
from botocore.config import Config
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .mqtt_ingest import MqttIngest

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ingest")

DSN = make_conninfo(
    host=os.getenv("PGHOST", "timescaledb"),
    port=os.getenv("PGPORT", "5432"),
    dbname=os.environ["POSTGRES_DB"],
    user=os.environ["POSTGRES_USER"],
    password=os.environ["POSTGRES_PASSWORD"],
)
BUCKET = os.environ["MINIO_BUCKET"]
DEFAULT_WINDOW_MS = 10 * 60 * 1000
INCIDENT_WINDOW_MS = 24 * 60 * 60 * 1000
PRESIGN_EXPIRES_S = 15 * 60
CLIENT_QUEUE_SIZE = 100

MS = "(extract(epoch from {col}) * 1000)::bigint"   # exact: extract returns numeric
TS = "timestamptz 'epoch' + %s * interval '1 millisecond'"

pool = ConnectionPool(DSN, min_size=1, max_size=4, open=False,
                      check=ConnectionPool.check_connection, kwargs={"row_factory": dict_row})

# Signed for the public URL: a signature covers the host, so a URL signed for
# minio:9000 wouldn't work in a browser and can't be rewritten (decisions log).
# Signing makes no network call, so localhost not resolving in here doesn't matter.
s3_public = boto3.client(
    "s3",
    endpoint_url=os.environ["MINIO_PUBLIC_URL"],
    aws_access_key_id=os.environ["MINIO_ROOT_USER"],
    aws_secret_access_key=os.environ["MINIO_ROOT_PASSWORD"],
    region_name="us-east-1",
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)


class Hub:
    """WebSocket fan-out. Event loop thread only.

    Each client has its own bounded queue and sender task, so a slow or dead
    client never delays the others. A client whose queue fills is dropped.
    """

    def __init__(self):
        self.clients = {}   # WebSocket -> asyncio.Queue

    def add(self, ws):
        q = asyncio.Queue(maxsize=CLIENT_QUEUE_SIZE)
        self.clients[ws] = q
        return q

    def remove(self, ws):
        self.clients.pop(ws, None)

    def broadcast(self, msg):
        for ws, q in list(self.clients.items()):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                log.warning("Dropping slow WebSocket client")
                self.remove(ws)
                asyncio.ensure_future(_close_quietly(ws))


async def _close_quietly(ws):
    try:
        await ws.close()
    except Exception:
        pass


hub = Hub()


@asynccontextmanager
async def lifespan(app):
    pool.open(wait=False)
    ingest = MqttIngest(DSN, asyncio.get_running_loop(), hub.broadcast)
    ingest.start()
    try:
        yield
    finally:
        ingest.stop()
        pool.close()


app = FastAPI(title="Herdbook ingest", lifespan=lifespan)


@app.get("/robots")
def list_robots():
    with pool.connection() as conn:
        return conn.execute(
            f"SELECT robot_id, status, {MS.format(col='last_seen')} AS last_seen, last_state "
            "FROM robots ORDER BY robot_id"
        ).fetchall()


@app.get("/robots/{robot_id}/telemetry")
def robot_telemetry(robot_id: str, since: int | None = None):
    if since is None:
        since = int(time.time() * 1000) - DEFAULT_WINDOW_MS
    with pool.connection() as conn:
        return conn.execute(
            f"SELECT robot_id, boot_id, seq, {MS.format(col='ts')} AS ts, x, y, heading, speed, battery, mode "
            f"FROM telemetry WHERE robot_id = %s AND ts >= {TS} ORDER BY ts",
            (robot_id, since),
        ).fetchall()


@app.get("/incidents")
def list_incidents(since: int | None = None):
    if since is None:
        since = int(time.time() * 1000) - INCIDENT_WINDOW_MS
    with pool.connection() as conn:
        return conn.execute(
            f"SELECT id, robot_id, {MS.format(col='event_ts')} AS event_ts, type, status, mcap_key, size_bytes "
            f"FROM incidents WHERE event_ts >= {TS} ORDER BY event_ts DESC, id DESC",
            (since,),
        ).fetchall()


@app.get("/incidents/{incident_id}/download")
def download_incident(incident_id: int):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT mcap_key FROM incidents WHERE id = %s AND status = 'ready'", (incident_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="incident not found or its clip isn't ready")
    url = s3_public.generate_presigned_url(
        "get_object", Params={"Bucket": BUCKET, "Key": row["mcap_key"]}, ExpiresIn=PRESIGN_EXPIRES_S
    )
    return {"url": url}


@app.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    q = hub.add(ws)

    async def sender():
        while True:
            await ws.send_json(await q.get())

    send_task = asyncio.create_task(sender())
    recv_task = asyncio.create_task(_drain(ws))
    try:
        # Whichever ends first (client gone, send failed) ends the connection.
        await asyncio.wait({send_task, recv_task}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        hub.remove(ws)
        for t in (send_task, recv_task):
            t.cancel()
        await _close_quietly(ws)


async def _drain(ws):
    try:
        while True:
            await ws.receive_text()
    except (WebSocketDisconnect, RuntimeError):
        pass
