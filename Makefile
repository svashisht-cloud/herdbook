# Shortcuts for running and breaking the fleet. Run from the repo root.
#   make fault|cut|restore ROBOT=robotN    one-robot fault injection (scripts/robot.sh)
#   make gaps [SINCE=<utc ms>]             gap report
SHELL := /bin/bash
COMPOSE := docker compose -f infra/docker-compose.yml

.PHONY: up reset gaps fault cut restore failure failure-quick cue

up:
	$(COMPOSE) up -d --build

reset:
	scripts/reset.sh

gaps:
	scripts/gap_report.sh $(SINCE)

fault cut restore:
	@[ -n "$(ROBOT)" ] || { echo "usage: make $@ ROBOT=robotN"; exit 2; }
	scripts/robot.sh $@ $(ROBOT)

failure:
	scripts/failure_demo.sh

failure-quick:
	scripts/failure_demo.sh --quick

cue:
	@scripts/recording_cue.sh
