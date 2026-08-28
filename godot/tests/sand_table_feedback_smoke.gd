extends SceneTree

func _init() -> void:
	var main_scene = load("res://scenes/Main.tscn")
	var main = main_scene.instantiate()
	get_root().add_child(main)
	await process_frame

	main.engine_connected = false
	main.sim_time = 20
	main.order = {
		"status": "executing",
		"type": "move",
		"unitId": "qin-main",
		"originAreaId": "qin-west-camp",
		"targetAreaId": "dan-river-valley",
		"route": ["qin-west-camp", "dan-river-valley"],
		"totalTravelSeconds": 150,
		"remainingTravelSeconds": 60,
		"currentTerrain": {"terrainType": "river", "label": "丹水渡河"},
		"recipientCommanderId": "bai-qi",
		"communicationMode": "direct",
	}
	main.reported_signals = [{
		"id": "visual-report",
		"areaId": "zhao-main-camp",
		"confidence": "low",
		"sourceType": "前出斥候",
		"text": "疑似发现赵军活动",
		"expiresAt": 26,
		"uncertainty": {"level": "low", "radiusNormalized": 0.16, "label": "可能偏离相邻区域"},
	}]
	main.map_notices = [{
		"kind": "report_expired",
		"areaId": "western-gate",
		"label": "情报失效",
		"expiresAt": 32,
	}]
	main._refresh()

	assert(main.sand_table._movement_terrain_label(main.order) == "渡河中")
	assert(main.sand_table._report_status_text(main.reported_signals[0]) == "低可信 · 将失效 6秒")
	assert(main.sand_table.transient_notices.size() == 1)
	print("Godot sand-table feedback smoke test passed")

	var hold_seconds := float(OS.get_environment("VISUAL_FIXTURE_HOLD_SECONDS"))
	if hold_seconds > 0.0:
		await create_timer(hold_seconds).timeout
	quit()
