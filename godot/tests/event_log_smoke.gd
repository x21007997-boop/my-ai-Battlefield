extends SceneTree

func _init() -> void:
	var event_log: BattlefieldEventLog = BattlefieldEventLog.new()
	event_log.configure("changping-260")
	event_log.append(3, "order_issued", {"unitId": "qin-main", "targetAreaId": "dan-river-valley"})
	var snapshot: Dictionary = event_log.snapshot()
	var event: Dictionary = snapshot.events[0]
	if snapshot.scenarioId != "changping-260":
		push_error("回放场景 ID 不正确")
		quit(1)
	if event.type != "order_issued" or event.payload.targetAreaId != "dan-river-valley":
		push_error("回放事件内容不正确")
		quit(1)
	if snapshot.disclosure.rawEnemyTruthIncluded or snapshot.disclosure.combatExchangeIncluded:
		push_error("回放泄露了不应出现的真值")
		quit(1)
	print("Godot event log smoke test passed")
	quit()
