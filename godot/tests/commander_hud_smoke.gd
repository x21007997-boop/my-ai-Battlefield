extends SceneTree

func _init() -> void:
	var main_scene = load("res://scenes/Main.tscn")
	var main = main_scene.instantiate()
	get_root().add_child(main)
	await process_frame

	assert(main.intelligence_panel != null)
	assert(main.deception_panel != null)
	assert(main.battle_panel != null)
	assert(main.speed_option != null)
	assert(main.new_battle_button != null)
	assert(main.new_battle_button.text == "新局")
	assert(main.guide_label != null)
	assert(main.guide_label.text.contains("点击沙盘"))
	assert(main.intelligence_button.text == "情报 0")
	# Keep the onboarding path deterministic without requiring a running gateway.
	main.engine_connected = false
	main._on_area_selected("dan-river-valley")
	assert(main.guide_label.text.contains("机动"))
	assert(main.guide_label.text.contains("传达"))
	main._issue_move()
	assert(main.order.get("status", "") == "transmitting")
	assert(main.feedback_label.text.contains("命令已接收"))
	assert(main.guide_label.text.contains("军令已下达"))
	main._step_second()
	assert(main.order.get("status", "") == "executing")
	assert(main.command_state_label.text.contains("执行中"))
	assert(main.feedback_label.text.contains("命令已抵达"))
	main._on_speed_selected(2)
	assert(main.simulation_speed == 5)

	main._toggle_battle_panel()
	assert(main.battle_panel.visible)
	assert(main.battle_label.text.contains("统帅层战役意图"))
	assert(main.battle_label.text.contains("当前胜利门槛"))
	assert(main.battle_label.text.contains("封锁"))
	assert(main.battle_label.text.contains("待完成部署后开始确认"))
	assert(main.battle_label.text.contains("剩余"))

	main._toggle_intelligence_panel()
	assert(main.intelligence_panel.visible)
	assert(not main.deception_panel.visible)
	assert(not main.battle_panel.visible)
	assert(main.intelligence_label.text.contains("当前没有前线情报"))

	main._toggle_deception_panel()
	assert(main.deception_panel.visible)
	assert(not main.intelligence_panel.visible)
	assert(main.deception_list.get_child_count() == 2)

	print("Godot commander HUD smoke test passed")
	quit()
