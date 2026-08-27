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
	assert(main.intelligence_button.text == "情报 0")
	main._on_speed_selected(2)
	assert(main.simulation_speed == 5)

	main._toggle_battle_panel()
	assert(main.battle_panel.visible)
	assert(main.battle_label.text.contains("统帅层战役意图"))
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
