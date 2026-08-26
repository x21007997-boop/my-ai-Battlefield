extends RefCounted

class_name BattlefieldReplayPlayer

const EventLog = preload("res://scripts/event_log.gd")

var scenario_id := ""
var initial_friendly_units: Array = []
var initial_selected_unit_id := ""
var events: Array = []
var cursor := 0
var state: Dictionary = {}

func configure(friendly_units: Array, selected_unit_id: String = "") -> void:
	initial_friendly_units = friendly_units.duplicate(true)
	initial_selected_unit_id = selected_unit_id
	state = _initial_state(initial_selected_unit_id)

func load_snapshot(snapshot: Dictionary, expected_scenario_id: String = "") -> String:
	var validation := EventLog.validate_snapshot(snapshot, expected_scenario_id)
	if validation != "":
		return validation
	scenario_id = str(snapshot.get("scenarioId", ""))
	events = snapshot.get("events", []).duplicate(true)
	cursor = 0
	return ""

func duration() -> int:
	if events.is_empty():
		return 0
	return int(events[events.size() - 1].get("simTime", 0))

func seek(target_time: int) -> Dictionary:
	state = _initial_state(initial_selected_unit_id)
	cursor = 0
	var target: int = max(0, target_time)
	while cursor < events.size() and int(events[cursor].get("simTime", 0)) <= target:
		_apply_event(events[cursor])
		cursor += 1
	state["simTime"] = target
	return state.duplicate(true)

func advance_to(target_time: int) -> Dictionary:
	var target: int = max(0, target_time)
	if target < int(state.get("simTime", 0)):
		return seek(target)
	while cursor < events.size() and int(events[cursor].get("simTime", 0)) <= target:
		_apply_event(events[cursor])
		cursor += 1
	state["simTime"] = target
	return state.duplicate(true)

func current_state() -> Dictionary:
	return state.duplicate(true)

func _initial_state(selected_unit_id: String) -> Dictionary:
	var selected := selected_unit_id
	if selected == "" and not initial_friendly_units.is_empty():
		selected = str(initial_friendly_units[0].get("id", ""))
	return {
		"simTime": 0,
		"friendlyUnits": initial_friendly_units.duplicate(true),
		"reportedSignals": [],
		"order": {},
		"pendingObservation": {},
		"selectedUnitId": selected,
		"selectedTargetAreaId": "",
		"running": false,
		"outcome": null,
		"eventCount": 0,
		"timeline": [],
		"lastEventType": "",
	}

func _apply_event(event: Dictionary) -> void:
	var payload: Dictionary = event.get("payload", {})
	state["simTime"] = max(int(state.get("simTime", 0)), int(event.get("simTime", 0)))
	state["eventCount"] = int(state.get("eventCount", 0)) + 1
	state["lastEventType"] = str(event.get("type", ""))
	var timeline: Array = state.get("timeline", [])
	timeline.append(event.duplicate(true))
	if timeline.size() > 12:
		timeline.pop_front()
	state["timeline"] = timeline

	match str(event.get("type", "")):
		"order_issued":
			var issued := payload.duplicate(true)
			issued["status"] = "transmitting"
			state["order"] = issued
		"order_delivered":
			var order: Dictionary = state.get("order", {})
			if order.is_empty() or str(order.get("unitId", "")) == str(payload.get("unitId", "")):
				order.merge(payload, true)
				order["status"] = "executing"
				state["order"] = order
		"unit_arrived":
			_update_unit_area(str(payload.get("unitId", "")), str(payload.get("areaId", payload.get("targetAreaId", ""))))
			var arrived_order: Dictionary = state.get("order", {})
			if arrived_order.is_empty() or str(arrived_order.get("unitId", "")) == str(payload.get("unitId", "")):
				arrived_order.merge(payload, true)
				arrived_order["status"] = "completed"
				state["order"] = arrived_order
		"unit_entered_terrain":
			var entered_order: Dictionary = state.get("order", {})
			entered_order["currentTerrain"] = {
				"featureId": payload.get("featureId", ""),
				"terrainType": payload.get("terrainType", ""),
				"label": payload.get("label", "地形"),
				"method": payload.get("method", null),
			}
			state["order"] = entered_order
		"unit_exited_terrain":
			var exited_order: Dictionary = state.get("order", {})
			exited_order["currentTerrain"] = null
			exited_order["lastTerrainTransition"] = {
				"featureId": payload.get("featureId", ""),
				"terrainType": payload.get("terrainType", ""),
				"label": payload.get("label", "地形通过"),
				"method": payload.get("method", null),
				"crossedAt": int(event.get("simTime", 0)),
			}
			state["order"] = exited_order
		"observation_queued":
			state["pendingObservation"] = payload.duplicate(true)
		"report_arrived":
			var reports: Array = state.get("reportedSignals", [])
			reports.append({
				"id": payload.get("reportId", ""),
				"areaId": payload.get("reportedAreaId", payload.get("areaId", "")),
				"confidence": payload.get("confidence", "unknown"),
				"sourceType": payload.get("sourceType", "前线报告"),
				"text": payload.get("text", "发现敌情"),
				"expiresAt": payload.get("expiresAt", null),
				"uncertainty": payload.get("uncertainty", {}),
			})
			state["reportedSignals"] = reports
			state["pendingObservation"] = {}
		"report_expired":
			var active_reports: Array = []
			for report in state.get("reportedSignals", []):
				if str(report.get("id", "")) != str(payload.get("reportId", "")):
					active_reports.append(report)
			state["reportedSignals"] = active_reports
		"commander_unit_selected":
			state["selectedUnitId"] = payload.get("unitId", state.get("selectedUnitId", ""))
		"commander_target_selected":
			state["selectedTargetAreaId"] = payload.get("areaId", state.get("selectedTargetAreaId", ""))
		"simulation_resumed":
			state["running"] = true
		"simulation_paused":
			state["running"] = false
		"battle_ended":
			state["running"] = false
			state["outcome"] = {
				"id": payload.get("outcomeId", event.get("outcomeId", "")),
				"result": payload.get("result", event.get("result", "unknown")),
				"side": payload.get("side", event.get("side", null)),
				"reason": payload.get("reason", event.get("reason", "unknown")),
			}
		_:
			pass

func _update_unit_area(unit_id: String, area_id: String) -> void:
	var units: Array = state.get("friendlyUnits", [])
	for index in range(units.size()):
		if str(units[index].get("id", "")) != unit_id:
			continue
		var unit: Dictionary = units[index].duplicate(true)
		unit["areaId"] = area_id
		units[index] = unit
		break
	state["friendlyUnits"] = units
