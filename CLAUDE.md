# Herdbook

@ARCHITECTURE.md

## Working rules

- ARCHITECTURE.md (imported above) is your map of the repo. Don't scan the whole repository to orient yourself; open only the files the task touches.
- The stack and every logged decision are settled. Don't re-debate, swap or "improve" them. If a task seems to need a change to one, stop and ask.
- Stay in scope. Don't add features, services or dependencies the task didn't ask for. If something looks worth adding, say so instead of building it.
- Do only the task given. Node behavior in `robot/` (motion, events, recording, MQTT, queue logic) is Shubh's to write. Don't implement it unless the task explicitly says to.
- When a decision is made or changed, add or update one bullet in ARCHITECTURE.md's decisions log in the same change, in the format "decision — choice. Why."
- Never commit `infra/.env` or credentials. Published ports bind to 127.0.0.1.
- The compose file is `infra/docker-compose.yml`. Run `docker compose config` on any compose edit before calling it done.
- After a change, report what you changed and how you verified it, with the command output.
