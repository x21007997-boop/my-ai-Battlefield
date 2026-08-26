extends RefCounted

class_name BattlefieldEventLog

const SCHEMA_VERSION := 1
const FORBIDDEN_KEYS := ["actualAreaId", "enemyUnits", "combatExchange", "rawEnemyTruth"]

var scenario_id := ""
var events: Array[Dictionary] = []
var next_event_number := 1

func configure(source_scenario_id: String) -> void:
	scenario_id = source_scenario_id

func append(sim_time: int, event_type: String, payload: Dictionary = {}) -> Dictionary:
	var violation := _find_forbidden_key(payload)
	if violation != "":
		push_error("事件包含禁止暴露字段：" + violation)
		return {}
	var event := {
		"id": "game-event-%04d" % next_event_number,
		"schemaVersion": SCHEMA_VERSION,
		"simTime": sim_time,
		"type": event_type,
		"payload": payload.duplicate(true),
	}
	next_event_number += 1
	events.append(event)
	return event

func snapshot() -> Dictionary:
	return {
		"schemaVersion": SCHEMA_VERSION,
		"scenarioId": scenario_id,
		"events": events.duplicate(true),
		"disclosure": {
			"rawEnemyTruthIncluded": false,
			"combatExchangeIncluded": false,
			"source": "commander-event-stream",
		},
	}

static func load_snapshot(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var parsed = JSON.parse_string(file.get_as_text())
	return parsed if parsed is Dictionary else {}

static func validate_snapshot(snapshot: Dictionary, expected_scenario_id: String = "") -> String:
	if int(snapshot.get("schemaVersion", -1)) != SCHEMA_VERSION:
		return "不支持的回放协议版本。"
	var scenario_id_value := str(snapshot.get("scenarioId", ""))
	if scenario_id_value == "":
		return "回放缺少战役标识。"
	if expected_scenario_id != "" and scenario_id_value != expected_scenario_id:
		return "回放战役与当前场景不匹配。"
	var disclosure: Dictionary = snapshot.get("disclosure", {})
	if disclosure.get("rawEnemyTruthIncluded", false) == true:
		return "回放包含敌军真值。"
	if disclosure.get("combatExchangeIncluded", false) == true:
		return "回放包含战斗交换真值。"
	var raw_events = snapshot.get("events", [])
	if not raw_events is Array:
		return "回放缺少事件数组。"
	var previous_time := -1
	for index in range(raw_events.size()):
		var event = raw_events[index]
		if not event is Dictionary:
			return "回放事件格式无效。"
		if int(event.get("schemaVersion", -1)) != SCHEMA_VERSION:
			return "回放事件协议版本无效。"
		if not event.get("type", "") is String:
			return "回放事件缺少类型。"
		var sim_time := int(event.get("simTime", -1))
		if sim_time < 0 or sim_time < previous_time:
			return "回放事件时间顺序无效。"
		previous_time = sim_time
		var payload = event.get("payload", {})
		var violation := _find_forbidden_key(payload)
		if violation != "":
			return "回放包含禁止暴露字段：" + violation
	return ""

static func _find_forbidden_key(value: Variant, path: String = "payload") -> String:
	if value is Dictionary:
		for key in value.keys():
			var key_name := str(key)
			if key_name in FORBIDDEN_KEYS:
				return path + "." + key_name
			var nested := _find_forbidden_key(value[key], path + "." + key_name)
			if nested != "":
				return nested
	elif value is Array:
		for index in range(value.size()):
			var nested := _find_forbidden_key(value[index], path + "[" + str(index) + "]")
			if nested != "":
				return nested
	return ""

func save_to(path: String) -> int:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return ERR_CANT_OPEN
	file.store_string(JSON.stringify(snapshot(), "\t"))
	return OK
