extends Node2D

const EventLog = preload("res://scripts/event_log.gd")
const ReplayPlayer = preload("res://scripts/replay_player.gd")
const EngineGateway = preload("res://scripts/engine_gateway.gd")
const SESSION_SAVE_PATH := "user://changping-session.json"

@onready var sand_table: Node2D = $SandTable
@onready var interface: CanvasLayer = $Interface
@onready var map_camera: Camera2D = $MapCamera

var scenario: Dictionary = {}
var sim_time := 0
var running := false
var tick_accumulator := 0.0
var friendly_units: Array = []
var commanders: Array = []
var player_commander_id := ""
var selected_commander_id := ""
var reported_signals: Array = []
var map_notices: Array = []
var order: Dictionary = {}
var pending_scout: Dictionary = {}
var pending_observations: Array = []
var deception_actions: Array = []
var deception_history: Array = []
var strategy_actions: Array = []
var resource_state: Dictionary = {}
var strategy_reliability := 1.0
var objectives: Array = []
var resolution_state: Dictionary = {}
var review: Dictionary = {}
var log_lines: Array[String] = []
var selected_unit_id := ""
var selected_target_area_id := ""
var panning := false
var event_log: BattlefieldEventLog
var replay_player: BattlefieldReplayPlayer
var replay_mode := false
var replay_accumulator := 0.0
var outcome: Dictionary = {}
var engine_gateway: Node
var engine_session: Dictionary = {}
var engine_connected := false
var engine_tick_accumulator := 0.0
var simulation_speed := 1
var session_was_resumed := false
var clock_label: Label
var status_label: Label
var selection_label: Label
var feedback_label: Label
var log_label: RichTextLabel
var run_button: Button
var scout_button: Button
var deception_button: Button
var task_option: OptionButton
var move_button: Button
var hold_button: Button
var zoom_label: Label
var replay_button: Button
var load_replay_button: Button
var exit_replay_button: Button
var replay_slider: HSlider
var command_state_label: Label
var commander_option: OptionButton
var outcome_label: Label
var free_order_input: LineEdit
var free_order_button: Button
var hud_metrics_label: Label
var log_panel: Panel
var log_button: Button
var replay_panel: Panel
var intelligence_button: Button
var intelligence_panel: Panel
var intelligence_label: RichTextLabel
var deception_panel: Panel
var deception_list: VBoxContainer
var deception_hint_label: Label
var selected_deception_action_id := ""
var battle_button: Button
var battle_panel: Panel
var battle_label: RichTextLabel
var speed_option: OptionButton
var new_battle_button: Button
var guide_label: Label

const TASK_COMMANDS := [
	{"type": "guard", "label": "警戒"},
	{"type": "cover", "label": "掩护"},
	{"type": "blockade", "label": "封锁"},
	{"type": "decoy", "label": "诱敌"},
	{"type": "interdict_supply", "label": "截粮"},
	{"type": "retreat", "label": "撤退"},
]

func _ready() -> void:
	scenario = _load_json("res://data/changping-260.json")
	_apply_commander_session()
	var initial_session_value = scenario.get("commanderSession", {})
	if initial_session_value is Dictionary:
		var initial_session: Dictionary = initial_session_value
		var initial_resolution_value = initial_session.get("resolution", {})
		if initial_resolution_value is Dictionary:
			resolution_state = initial_resolution_value.duplicate(true)
	event_log = EventLog.new()
	event_log.configure(str(scenario.get("sourceScenarioId", "changping-260")))
	event_log.append(0, "scenario_loaded", {"commanderSide": "qin", "rawEnemyTruthIncluded": false})
	friendly_units = scenario.get("friendlyUnits", []).duplicate(true)
	var raw_commanders = scenario.get("commanders", [])
	commanders = raw_commanders.duplicate(true) if raw_commanders is Array else []
	player_commander_id = str(scenario.get("playerCommanderId", ""))
	deception_actions = scenario.get("deceptionActions", []).duplicate(true)
	resource_state = scenario.get("resources", {}).duplicate(true)
	objectives = scenario.get("objectives", []).duplicate(true)
	if friendly_units.size() > 0:
		selected_unit_id = str(friendly_units[0].get("id", ""))
	selected_commander_id = _commander_id_for_unit(selected_unit_id)
	if selected_commander_id == "":
		selected_commander_id = player_commander_id
	replay_player = ReplayPlayer.new()
	replay_player.configure(friendly_units, selected_unit_id)
	sand_table.configure(scenario)
	sand_table.area_selected.connect(_on_area_selected)
	sand_table.unit_selected.connect(_on_unit_selected)
	_build_interface()
	_connect_engine_gateway_if_configured()
	_add_log("进入长平战役关卡。")
	_add_log("当前只显示我方旗帜和已抵达的前线报告。")
	_set_feedback("请选择部队和目标区域；每次命令都会显示接收和执行状态。", "info")
	_refresh()

func _apply_commander_session() -> void:
	var session: Dictionary = scenario.get("commanderSession", {})
	if session.is_empty():
		return
	var disclosure: Dictionary = session.get("disclosure", {})
	if disclosure.get("rawEnemyUnitsIncluded", false) == true or disclosure.get("actualEnemyPositionsIncluded", false) == true or disclosure.get("combatTruthIncluded", false) == true:
		push_error("指挥官会话契约包含禁止下发的真值。")
		return
	var map: Dictionary = session.get("map", {})
	if map.is_empty():
		push_error("指挥官会话契约缺少地图投影。")
		return
	for key in ["areas", "routes", "landmarks", "friendlyUnits"]:
		if map.has(key):
			scenario[key] = map[key]
	var session_commanders = session.get("commanders", [])
	if session_commanders is Array:
		scenario["commanders"] = session_commanders
	var session_player_commander_id := str(session.get("playerCommanderId", ""))
	if session_player_commander_id != "":
		scenario["playerCommanderId"] = session_player_commander_id

func _process(delta: float) -> void:
	if engine_connected and not replay_mode:
		if not running or engine_gateway.busy():
			return
		engine_tick_accumulator += delta
		while engine_tick_accumulator >= 1.0 and not engine_gateway.busy():
			var advance_seconds: int = min(simulation_speed, int(engine_tick_accumulator))
			advance_seconds = max(1, advance_seconds)
			engine_tick_accumulator -= advance_seconds
			engine_gateway.send_command({"type": "advance", "seconds": advance_seconds})
		return
	if replay_mode:
		if not running:
			return
		replay_accumulator += delta * float(simulation_speed)
		while replay_accumulator >= 1.0:
			replay_accumulator -= 1.0
			_step_replay_second()
		return
	if not running:
		return
	tick_accumulator += delta * float(simulation_speed)
	while tick_accumulator >= 1.0:
		tick_accumulator -= 1.0
		_step_second()

func _connect_engine_gateway_if_configured() -> void:
	var gateway_url := OS.get_environment("BATTLE_ENGINE_URL")
	if gateway_url == "":
		gateway_url = "http://127.0.0.1:4317"
	engine_gateway = EngineGateway.new()
	engine_gateway.configure(gateway_url)
	engine_gateway.response_received.connect(_on_engine_response)
	engine_gateway.request_failed.connect(_on_engine_request_failed)
	add_child(engine_gateway)
	engine_gateway.start_session(_load_saved_session_id())

func _on_engine_response(operation: String, response: Dictionary) -> void:
	var session: Dictionary = response.get("session", {})
	if session.is_empty():
		return
	engine_session = session.duplicate(true)
	engine_connected = true
	var response_session_id := str(response.get("sessionId", ""))
	if response_session_id != "":
		_save_session_id(response_session_id)
	_apply_engine_session(session)
	var response_events: Array = response.get("events", [])
	for event in response_events:
		_add_log(_replay_event_text(event))
	if outcome.size() > 0:
		_set_feedback("战役已结束：%s。可导出或载入本局回放。" % str(outcome.get("title", outcome.get("result", "战役结束"))), "success")
	elif operation == "start_session":
		if response.get("resumed", false):
			_show_session_resumed_feedback()
		elif response.get("resumeRequested", false):
			session_was_resumed = false
			_add_log("上一局存档未找到，已建立新的长平战局。")
			_set_feedback("未找到上一局存档，已建立新的长平战局。", "info")
		else:
			session_was_resumed = false
			_set_feedback("前线已接入，命令与侦察链路就绪。", "success")
	elif not response.get("accepted", true):
		_set_feedback("操作未执行：%s" % str(response.get("error", "内核拒绝了这次操作。")), "error")
	elif operation == "command":
		var result: Dictionary = response.get("result", {}) if response.get("result", {}) is Dictionary else {}
		var event_type := str(response_events.back().get("type", "")) if not response_events.is_empty() else str(result.get("type", ""))
		if event_type != "":
			match event_type:
				"order_issued": _set_feedback("命令已接收：部队进入传递状态。", "success")
				"command_interpreted": _set_feedback("AI已理解军令，正在交给接收军官。", "success")
				"command_delivered": _set_feedback("传令抵达：接收军官已收到军令。", "success")
				"officer_decision": _set_feedback(_officer_decision_feedback(response_events.back()), "success" if str(response_events.back().get("decision", "")) != "refused" else "error")
				"officer_route_changed": _set_feedback(_officer_route_feedback(response_events.back()), "success")
				"observation_created": _set_feedback("侦察已接收：报告正在返回指挥部。", "success")
				"reconnaissance_issued": _set_feedback("侦察已接收：斥候正在准备，资源已扣除。", "success")
				"reconnaissance_command_delivered": _set_feedback("侦察军令抵达：前线副将开始整备斥候。", "success")
				"reconnaissance_exposed": _set_feedback("侦察受阻：斥候行迹暴露，回报可信度下降。", "error")
				"deception_issued": _set_feedback("计策已接收：正在准备投放，资源已扣除。" if str(result.get("status", "")) == "preparing" else "计策已接收：敌方将依据自己的认知行动。", "success")
				"deception_command_delivered": _set_feedback("计策军令抵达：前线开始准备投放。", "success")
				"deception_exposed": _set_feedback("计策暴露：敌方可能已经识破，后续误导可信度下降。", "error")
				"strategy_reliability_reduced": _set_feedback("情报链可信度下降：后续同类行动更容易被识破。", "error")
				_: _set_feedback("操作已接收，战场状态正在刷新。", "success")
	if operation != "start_session":
		for event in response_events:
			_apply_runtime_event_feedback(event)
	_refresh()

func _apply_runtime_event_feedback(event: Dictionary) -> void:
	var payload_value = event.get("payload", {})
	var payload: Dictionary = payload_value if payload_value is Dictionary else event
	match str(event.get("type", "")):
		"order_delivered":
			_set_feedback("命令已经抵达部队，开始执行。", "success")
		"officer_decision":
			if str(payload.get("decision", "")) == "refused":
				_set_feedback(_officer_decision_feedback(event), "error")
		"officer_delay_completed":
			_add_map_notice("execution_resumed", _order_event_area(payload), "恢复执行", 10)
			_set_feedback("副将整备完成，部队已经恢复执行。", "success")
		"order_completed":
			_set_feedback("当前军令已经执行完成。", "success")
		"unit_arrived":
			_set_feedback("部队已抵达%s。" % _area_name(str(payload.get("areaId", payload.get("targetAreaId", "")))), "success")
		"order_cancelled":
			_set_feedback("军令已经取消：%s" % str(payload.get("reason", "不再执行")), "info")
		"report_arrived":
			var area_id := str(payload.get("reportedAreaId", payload.get("areaId", "")))
			_set_feedback("前线情报抵达：%s（%s，%s）。" % [_area_name(area_id), _confidence_label(str(payload.get("confidence", "unknown"))), _uncertainty_label(payload)], "success")
		"report_expired":
			_add_map_notice("report_expired", str(payload.get("reportedAreaId", payload.get("areaId", ""))), "情报失效", 12)
			_set_feedback("前线情报已失效：沙盘上的疑似敌情将被移除。", "info")
		"order_blocked":
			_set_feedback("部队机动受阻：目标区域的通路暂时被封锁。", "error")
		"supply_depleted":
			_set_feedback("后勤警报：一支部队的补给已耗尽，战力会受到影响。", "error")
		"unit_entered_terrain":
			_set_feedback("前线回报：部队已进入%s段。" % str(payload.get("label", "复杂地形")), "info")
		"unit_exited_terrain":
			_set_feedback("前线回报：部队已完成%s。" % str(payload.get("label", "地形通过")), "info")
		"victory_hold_started":
			_set_feedback("隔离态势已建立：请继续维持，等待确认窗口完成。", "success")
		"victory_hold_broken":
			_set_feedback("隔离态势中断：需要重新建立封锁或前线认知。", "error")
		"battle_ended":
			_set_feedback("战役已结束：请打开“战局”查看战后复盘。", "success")

func _on_engine_request_failed(_operation: String, message: String) -> void:
	engine_connected = false
	_add_log("通用内核未连接：%s" % message)
	_set_feedback("实时内核连接失败：%s" % message, "error")
	_refresh()

func _show_session_resumed_feedback() -> void:
	session_was_resumed = true
	_add_log("已恢复上一局战局：当前进度与前线认知已载入。")
	_add_map_notice("session_resumed", _selected_unit_area(), "战局已恢复", 12)
	_set_feedback("已恢复上一局战局：命令与侦察链路就绪。", "success")

func _selected_unit_area() -> String:
	var unit_index := _unit_index(selected_unit_id)
	return str(friendly_units[unit_index].get("areaId", "")) if unit_index >= 0 else ""

func _order_event_area(payload: Dictionary) -> String:
	for key in ["areaId", "targetAreaId", "originAreaId", "reportedAreaId"]:
		var area_id := str(payload.get(key, ""))
		if area_id != "":
			return area_id
	var unit_id := str(payload.get("unitId", order.get("unitId", "")))
	var unit_index := _unit_index(unit_id)
	if unit_index >= 0:
		return str(friendly_units[unit_index].get("areaId", ""))
	return str(order.get("originAreaId", order.get("targetAreaId", "")))

func _load_saved_session_id() -> String:
	var file := FileAccess.open(SESSION_SAVE_PATH, FileAccess.READ)
	if file == null:
		return ""
	var parsed = JSON.parse_string(file.get_as_text())
	if not parsed is Dictionary:
		return ""
	if str(parsed.get("scenarioId", "")) != str(scenario.get("sourceScenarioId", "changping-260")):
		return ""
	return str(parsed.get("sessionId", ""))

func _save_session_id(session_id: String) -> void:
	if session_id == "":
		return
	var file := FileAccess.open(SESSION_SAVE_PATH, FileAccess.WRITE)
	if file == null:
		_add_log("战局已运行，但本地存档记录无法写入。")
		return
	file.store_string(JSON.stringify({
		"schemaVersion": 1,
		"scenarioId": scenario.get("sourceScenarioId", "changping-260"),
		"sessionId": session_id,
	}))

func _apply_engine_session(session: Dictionary) -> void:
	sim_time = int(session.get("simTime", sim_time))
	var session_commanders = session.get("commanders", null)
	if session_commanders is Array:
		commanders = session_commanders.duplicate(true)
	var session_player_commander_id := str(session.get("playerCommanderId", player_commander_id))
	if session_player_commander_id != "":
		player_commander_id = session_player_commander_id
	var map: Dictionary = session.get("map", {})
	if not map.is_empty():
		friendly_units = map.get("friendlyUnits", []).duplicate(true)
		reported_signals = map.get("reportedEnemySignals", []).duplicate(true)
		for key in ["areas", "routes", "landmarks"]:
			if map.has(key):
				scenario[key] = map[key]
	if selected_commander_id == "" or _commander_by_id(selected_commander_id).is_empty():
		selected_commander_id = _commander_id_for_unit(selected_unit_id)
		if selected_commander_id == "":
			selected_commander_id = player_commander_id
	var own_orders: Array = session.get("ownOrders", [])
	order = {}
	for own_order in own_orders:
		if own_order.get("status", "") in ["transmitting", "executing"]:
			order = own_order.duplicate(true)
			break
	if order.is_empty() and not own_orders.is_empty():
		order = own_orders[own_orders.size() - 1].duplicate(true)
	var own_observations: Array = session.get("ownObservations", [])
	pending_observations = []
	pending_scout = {}
	for observation in own_observations:
		if observation.get("status", "") == "in_transit":
			pending_observations.append(observation.duplicate(true))
	if not pending_observations.is_empty():
		pending_scout = pending_observations[0].duplicate(true)
	deception_actions = session.get("deceptionActions", deception_actions).duplicate(true)
	deception_history = session.get("deceptionHistory", []).duplicate(true)
	strategy_actions = session.get("strategyActions", []).duplicate(true)
	resource_state = session.get("resources", resource_state).duplicate(true)
	strategy_reliability = float(session.get("strategyReliability", strategy_reliability))
	objectives = session.get("objectives", objectives).duplicate(true)
	var session_resolution_value = session.get("resolution", resolution_state)
	if session_resolution_value is Dictionary:
		resolution_state = session_resolution_value.duplicate(true)
	review = session.get("review", {}).duplicate(true) if session.get("review", {}) is Dictionary else {}
	outcome = session.get("outcome", {}).duplicate(true) if session.get("outcome", {}) is Dictionary else {}
	if outcome.size() > 0:
		running = false

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_MIDDLE:
			panning = event.pressed
			get_viewport().set_input_as_handled()
			return
		if event.pressed and event.position.x < 1280.0:
			if event.button_index == MOUSE_BUTTON_WHEEL_UP:
				_set_zoom(map_camera.zoom.x + 0.1)
				get_viewport().set_input_as_handled()
			elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				_set_zoom(map_camera.zoom.x - 0.1)
				get_viewport().set_input_as_handled()
	elif event is InputEventMouseMotion and panning:
		map_camera.position -= event.relative / map_camera.zoom.x
		get_viewport().set_input_as_handled()

func _load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("无法读取战役数据：" + path)
		return {}
	var parsed = JSON.parse_string(file.get_as_text())
	return parsed if parsed is Dictionary else {}

func _panel_style(background: Color, border: Color, radius: int = 10, border_width: int = 1) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_color = border
	style.set_border_width_all(border_width)
	style.corner_radius_top_left = radius
	style.corner_radius_top_right = radius
	style.corner_radius_bottom_left = radius
	style.corner_radius_bottom_right = radius
	return style

func _add_label(parent: Control, text: String, rect: Rect2, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.position = rect.position
	label.size = rect.size
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	parent.add_child(label)
	return label

func _style_button(button: Button, accent: bool = false) -> void:
	var normal_color := Color(0.10, 0.07, 0.05, 0.84) if not accent else Color(0.42, 0.29, 0.15, 0.94)
	var hover_color := Color(0.22, 0.15, 0.10, 0.96) if not accent else Color(0.58, 0.39, 0.19, 0.98)
	button.add_theme_stylebox_override("normal", _panel_style(normal_color, Color(0.66, 0.47, 0.27, 0.75), 8, 1))
	button.add_theme_stylebox_override("hover", _panel_style(hover_color, Color("#e4c58e"), 8, 1))
	button.add_theme_stylebox_override("pressed", _panel_style(Color(0.31, 0.20, 0.12, 0.98), Color("#f0d8a6"), 8, 1))
	button.add_theme_color_override("font_color", Color("#f0d8a6"))
	button.add_theme_color_override("font_hover_color", Color("#fff0c9"))
	button.add_theme_font_size_override("font_size", 12)

func _build_interface() -> void:
	var hud := Control.new()
	hud.name = "CommanderHUD"
	hud.mouse_filter = Control.MOUSE_FILTER_PASS
	interface.add_child(hud)

	var top_bar := Panel.new()
	top_bar.position = Vector2(18, 16)
	top_bar.size = Vector2(1244, 76)
	top_bar.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.88), Color(0.66, 0.47, 0.27, 0.9), 12, 2))
	hud.add_child(top_bar)
	_add_label(top_bar, "长平：迷雾军令", Rect2(24, 11, 250, 30), 22, Color("#f0d8a6"))
	_add_label(top_bar, "前262—前260 · 秦军统帅视角", Rect2(25, 43, 280, 18), 11, Color("#c1a58a"))
	hud_metrics_label = _add_label(top_bar, "", Rect2(315, 17, 280, 40), 12, Color("#d7c5ac"))
	hud_metrics_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	clock_label = _add_label(top_bar, "", Rect2(600, 13, 188, 30), 20, Color("#f0d8a6"))
	clock_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label = _add_label(top_bar, "", Rect2(790, 16, 238, 44), 12, Color("#d7c5ac"))
	run_button = Button.new()
	run_button.text = "开始实时推演"
	run_button.position = Vector2(1050, 15)
	run_button.size = Vector2(172, 46)
	run_button.add_theme_font_size_override("font_size", 15)
	_style_button(run_button, true)
	run_button.pressed.connect(_toggle_running)
	top_bar.add_child(run_button)

	var guide_panel := Panel.new()
	guide_panel.position = Vector2(226, 101)
	guide_panel.size = Vector2(930, 32)
	guide_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	guide_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.48), Color(0.66, 0.47, 0.27, 0.58), 8, 1))
	hud.add_child(guide_panel)
	guide_label = _add_label(guide_panel, "", Rect2(12, 5, 906, 22), 11, Color("#f0d8a6"))
	guide_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	guide_label.mouse_filter = Control.MOUSE_FILTER_IGNORE

	var unit_rail := Panel.new()
	unit_rail.position = Vector2(18, 140)
	unit_rail.size = Vector2(178, 138)
	unit_rail.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.78), Color(0.66, 0.47, 0.27, 0.8), 12, 1))
	hud.add_child(unit_rail)
	var unit_rail_title := _add_label(unit_rail, "秦军部队", Rect2(12, 10, 154, 22), 13, Color("#e4c58e"))
	unit_rail_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	for index in range(friendly_units.size()):
		var unit: Dictionary = friendly_units[index]
		var unit_button := Button.new()
		unit_button.text = str(unit.get("name", "部队"))
		unit_button.position = Vector2(12, 39 + index * 42)
		unit_button.size = Vector2(154, 34)
		unit_button.tooltip_text = "选中%s" % str(unit.get("name", "部队"))
		_style_button(unit_button)
		var unit_id := str(unit.get("id", ""))
		unit_button.pressed.connect(func(): _on_unit_selected(unit_id))
		unit_rail.add_child(unit_button)

	move_button = Button.new()
	move_button.text = "机动"
	move_button.position = Vector2(8, 40)
	move_button.size = Vector2(62, 38)
	move_button.tooltip_text = "向选定目标区域机动"
	_style_button(move_button)
	move_button.pressed.connect(_issue_move)

	hold_button = Button.new()
	hold_button.text = "坚守"
	hold_button.position = Vector2(8, 84)
	hold_button.size = Vector2(62, 38)
	hold_button.tooltip_text = "坚守当前阵地"
	_style_button(hold_button)
	hold_button.pressed.connect(_issue_hold)

	scout_button = Button.new()
	scout_button.text = "侦察"
	scout_button.position = Vector2(8, 128)
	scout_button.size = Vector2(62, 38)
	scout_button.tooltip_text = "派出前出斥候，报告可能失真"
	_style_button(scout_button)
	scout_button.pressed.connect(_dispatch_scout)

	deception_button = Button.new()
	deception_button.text = "计策"
	deception_button.position = Vector2(8, 172)
	deception_button.size = Vector2(62, 38)
	deception_button.tooltip_text = "施行一项计策，影响敌军认知"
	_style_button(deception_button)
	deception_button.pressed.connect(_issue_deception)

	var view_rail := Panel.new()
	view_rail.position = Vector2(18, 398)
	view_rail.size = Vector2(190, 46)
	view_rail.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.72), Color(0.66, 0.47, 0.27, 0.7), 12, 1))
	hud.add_child(view_rail)
	var zoom_out := Button.new()
	zoom_out.text = "−"
	zoom_out.position = Vector2(8, 7)
	zoom_out.size = Vector2(34, 32)
	zoom_out.tooltip_text = "缩小地图"
	_style_button(zoom_out)
	zoom_out.pressed.connect(func(): _set_zoom(map_camera.zoom.x - 0.1))
	view_rail.add_child(zoom_out)
	zoom_label = _add_label(view_rail, "100%", Rect2(47, 7, 46, 32), 11, Color("#e4c58e"))
	zoom_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	zoom_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var zoom_in := Button.new()
	zoom_in.text = "+"
	zoom_in.position = Vector2(98, 7)
	zoom_in.size = Vector2(34, 32)
	zoom_in.tooltip_text = "放大地图"
	_style_button(zoom_in)
	zoom_in.pressed.connect(func(): _set_zoom(map_camera.zoom.x + 0.1))
	view_rail.add_child(zoom_in)
	var reset_view := Button.new()
	reset_view.text = "复位"
	reset_view.position = Vector2(137, 7)
	reset_view.size = Vector2(45, 32)
	reset_view.tooltip_text = "复位地图视野"
	_style_button(reset_view)
	reset_view.pressed.connect(_reset_view)
	view_rail.add_child(reset_view)

	var speed_rail := Panel.new()
	speed_rail.position = Vector2(18, 454)
	speed_rail.size = Vector2(190, 44)
	speed_rail.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.72), Color(0.66, 0.47, 0.27, 0.7), 12, 1))
	hud.add_child(speed_rail)
	_add_label(speed_rail, "推演速度", Rect2(10, 7, 58, 28), 11, Color("#e4c58e"))
	speed_option = OptionButton.new()
	speed_option.position = Vector2(70, 6)
	speed_option.size = Vector2(110, 32)
	speed_option.tooltip_text = "调整实时推演或回放速度"
	_style_button(speed_option)
	for speed in [1, 2, 5, 10]:
		speed_option.add_item("%dx %s" % [speed, "实时" if speed == 1 else "加速"])
		speed_option.set_item_metadata(speed_option.item_count - 1, speed)
	speed_option.item_selected.connect(_on_speed_selected)
	speed_rail.add_child(speed_option)

	var utility_rail := Panel.new()
	utility_rail.position = Vector2(1184, 140)
	utility_rail.size = Vector2(78, 322)
	utility_rail.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.78), Color(0.66, 0.47, 0.27, 0.8), 12, 1))
	hud.add_child(utility_rail)
	var utility_title := _add_label(utility_rail, "指挥", Rect2(8, 10, 62, 22), 13, Color("#e4c58e"))
	utility_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	battle_button = Button.new()
	battle_button.text = "战局"
	battle_button.position = Vector2(8, 40)
	battle_button.size = Vector2(62, 34)
	battle_button.tooltip_text = "查看统帅层战役目标、时间压力和资源"
	_style_button(battle_button)
	battle_button.pressed.connect(_toggle_battle_panel)
	utility_rail.add_child(battle_button)
	intelligence_button = Button.new()
	intelligence_button.text = "情报"
	intelligence_button.position = Vector2(8, 80)
	intelligence_button.size = Vector2(62, 34)
	intelligence_button.tooltip_text = "查看已抵达和正在返回的前线情报"
	_style_button(intelligence_button)
	intelligence_button.pressed.connect(_toggle_intelligence_panel)
	utility_rail.add_child(intelligence_button)
	log_button = Button.new()
	log_button.text = "战报"
	log_button.position = Vector2(8, 120)
	log_button.size = Vector2(62, 34)
	_style_button(log_button)
	log_button.pressed.connect(_toggle_log_panel)
	utility_rail.add_child(log_button)

	replay_button = Button.new()
	replay_button.text = "导出"
	replay_button.position = Vector2(8, 160)
	replay_button.size = Vector2(62, 34)
	_style_button(replay_button)
	replay_button.pressed.connect(_export_replay)
	utility_rail.add_child(replay_button)

	load_replay_button = Button.new()
	load_replay_button.text = "载入"
	load_replay_button.position = Vector2(8, 200)
	load_replay_button.size = Vector2(62, 34)
	_style_button(load_replay_button)
	load_replay_button.pressed.connect(_load_replay)
	utility_rail.add_child(load_replay_button)

	exit_replay_button = Button.new()
	exit_replay_button.text = "退出"
	exit_replay_button.position = Vector2(8, 240)
	exit_replay_button.size = Vector2(62, 26)
	_style_button(exit_replay_button)
	exit_replay_button.pressed.connect(_exit_replay)
	utility_rail.add_child(exit_replay_button)

	new_battle_button = Button.new()
	new_battle_button.text = "新局"
	new_battle_button.position = Vector2(8, 276)
	new_battle_button.size = Vector2(62, 34)
	new_battle_button.tooltip_text = "建立新的长平战局，不覆盖上一局存档"
	_style_button(new_battle_button)
	new_battle_button.pressed.connect(_start_new_battle)
	utility_rail.add_child(new_battle_button)

	replay_panel = Panel.new()
	replay_panel.position = Vector2(850, 126)
	replay_panel.size = Vector2(320, 72)
	replay_panel.visible = false
	replay_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.92), Color(0.66, 0.47, 0.27, 0.9), 10, 1))
	hud.add_child(replay_panel)
	_add_label(replay_panel, "回放时间轴", Rect2(14, 8, 110, 18), 11, Color("#e4c58e"))
	replay_slider = HSlider.new()
	replay_slider.position = Vector2(14, 34)
	replay_slider.size = Vector2(292, 24)
	replay_slider.min_value = 0
	replay_slider.max_value = 0
	replay_slider.step = 1
	replay_slider.value_changed.connect(_on_replay_slider_changed)
	replay_panel.add_child(replay_slider)

	log_panel = Panel.new()
	log_panel.position = Vector2(850, 206)
	log_panel.size = Vector2(320, 248)
	log_panel.visible = false
	log_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.94), Color(0.66, 0.47, 0.27, 0.9), 10, 1))
	hud.add_child(log_panel)
	_add_label(log_panel, "最近战报", Rect2(14, 10, 150, 20), 13, Color("#e4c58e"))
	log_label = RichTextLabel.new()
	log_label.position = Vector2(14, 36)
	log_label.size = Vector2(292, 198)
	log_label.bbcode_enabled = false
	log_label.fit_content = false
	log_label.add_theme_font_size_override("normal_font_size", 12)
	log_label.add_theme_color_override("default_color", Color("#d7c5ac"))
	log_panel.add_child(log_label)

	intelligence_panel = Panel.new()
	intelligence_panel.position = Vector2(850, 126)
	intelligence_panel.size = Vector2(320, 320)
	intelligence_panel.visible = false
	intelligence_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.95), Color(0.66, 0.47, 0.27, 0.9), 10, 1))
	hud.add_child(intelligence_panel)
	_add_label(intelligence_panel, "前线情报", Rect2(14, 10, 180, 22), 14, Color("#e4c58e"))
	intelligence_label = RichTextLabel.new()
	intelligence_label.position = Vector2(14, 38)
	intelligence_label.size = Vector2(292, 264)
	intelligence_label.bbcode_enabled = false
	intelligence_label.fit_content = false
	intelligence_label.scroll_active = true
	intelligence_label.add_theme_font_size_override("normal_font_size", 12)
	intelligence_label.add_theme_color_override("default_color", Color("#d7c5ac"))
	intelligence_panel.add_child(intelligence_label)

	deception_panel = Panel.new()
	deception_panel.position = Vector2(850, 126)
	deception_panel.size = Vector2(320, 360)
	deception_panel.visible = false
	deception_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.96), Color(0.66, 0.47, 0.27, 0.9), 10, 1))
	hud.add_child(deception_panel)
	_add_label(deception_panel, "计策选择", Rect2(14, 10, 180, 22), 14, Color("#e4c58e"))
	deception_hint_label = _add_label(deception_panel, "", Rect2(14, 36, 292, 28), 10, Color("#c1a58a"))
	deception_list = VBoxContainer.new()
	deception_list.position = Vector2(14, 70)
	deception_list.size = Vector2(292, 276)
	deception_list.add_theme_constant_override("separation", 8)
	deception_panel.add_child(deception_list)

	battle_panel = Panel.new()
	battle_panel.position = Vector2(850, 126)
	battle_panel.size = Vector2(320, 360)
	battle_panel.visible = false
	battle_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.96), Color(0.66, 0.47, 0.27, 0.9), 10, 1))
	hud.add_child(battle_panel)
	_add_label(battle_panel, "战局态势", Rect2(14, 10, 180, 22), 14, Color("#e4c58e"))
	battle_label = RichTextLabel.new()
	battle_label.position = Vector2(14, 38)
	battle_label.size = Vector2(292, 300)
	battle_label.bbcode_enabled = false
	battle_label.fit_content = false
	battle_label.scroll_active = true
	battle_label.add_theme_font_size_override("normal_font_size", 12)
	battle_label.add_theme_color_override("default_color", Color("#d7c5ac"))
	battle_panel.add_child(battle_label)

	var command_card := Panel.new()
	command_card.position = Vector2(108, 548)
	command_card.size = Vector2(1064, 154)
	command_card.add_theme_stylebox_override("panel", _panel_style(Color(0.10, 0.07, 0.05, 0.91), Color(0.66, 0.47, 0.27, 0.92), 14, 2))
	hud.add_child(command_card)
	_add_label(command_card, "当前军令", Rect2(20, 12, 120, 24), 16, Color("#f0d8a6"))
	selection_label = _add_label(command_card, "", Rect2(20, 42, 255, 55), 12, Color("#e4c58e"))
	_add_label(command_card, "接收军官", Rect2(294, 9, 72, 18), 10, Color("#c1a58a"))
	commander_option = OptionButton.new()
	commander_option.position = Vector2(370, 7)
	commander_option.size = Vector2(238, 29)
	commander_option.tooltip_text = "选择由哪一位己方军官接收这道军令；不在身边时会派传令兵。"
	_style_button(commander_option)
	for commander in commanders:
		var commander_name := str(commander.get("name", "军官"))
		var commander_role := str(commander.get("role", ""))
		commander_option.add_item("%s · %s" % [commander_name, commander_role] if commander_role != "" else commander_name)
		commander_option.set_item_metadata(commander_option.item_count - 1, str(commander.get("id", "")))
	commander_option.item_selected.connect(_on_commander_selected)
	command_card.add_child(commander_option)
	command_state_label = _add_label(command_card, "", Rect2(294, 40, 302, 53), 11, Color("#d7c5ac"))
	feedback_label = _add_label(command_card, "", Rect2(620, 26, 420, 56), 12, Color("#e4c58e"))
	var command_hint := _add_label(command_card, "自由军令", Rect2(20, 88, 74, 18), 11, Color("#c1a58a"))
	command_hint.tooltip_text = "输入自然语言即可；下方为快捷命令。"

	free_order_input = LineEdit.new()
	free_order_input.placeholder_text = "例如：让王龁率机动部队向丹水河谷推进"
	free_order_input.position = Vector2(98, 103)
	free_order_input.size = Vector2(430, 36)
	free_order_input.tooltip_text = "可输入机动、坚守、侦察或施行计策"
	free_order_input.text_submitted.connect(_submit_free_order)
	command_card.add_child(free_order_input)

	free_order_button = Button.new()
	free_order_button.text = "传达"
	free_order_button.position = Vector2(538, 103)
	free_order_button.size = Vector2(80, 36)
	_style_button(free_order_button, true)
	free_order_button.pressed.connect(_submit_free_order)
	command_card.add_child(free_order_button)

	move_button.position = Vector2(630, 103)
	move_button.size = Vector2(76, 36)
	move_button.tooltip_text = "向选定目标区域机动"
	command_card.add_child(move_button)
	hold_button.position = Vector2(714, 103)
	hold_button.size = Vector2(76, 36)
	command_card.add_child(hold_button)
	scout_button.position = Vector2(798, 103)
	scout_button.size = Vector2(76, 36)
	command_card.add_child(scout_button)
	deception_button.position = Vector2(882, 103)
	deception_button.size = Vector2(76, 36)
	command_card.add_child(deception_button)

	task_option = OptionButton.new()
	task_option.text = "任务"
	task_option.position = Vector2(966, 103)
	task_option.size = Vector2(78, 36)
	task_option.tooltip_text = "选择警戒、掩护、封锁、诱敌、截粮或撤退"
	_style_button(task_option)
	for task in TASK_COMMANDS:
		task_option.add_item(str(task.get("label", "任务")))
		task_option.set_item_metadata(task_option.item_count - 1, str(task.get("type", "")))
	task_option.item_selected.connect(_on_task_selected)
	command_card.add_child(task_option)

	outcome_label = _add_label(hud, "", Rect2(420, 100, 400, 80), 14, Color("#b8d2a4"))
	outcome_label.visible = false

func _toggle_log_panel() -> void:
	if log_panel == null:
		return
	log_panel.visible = not log_panel.visible
	if log_panel.visible:
		intelligence_panel.visible = false
		deception_panel.visible = false
		battle_panel.visible = false

func _toggle_battle_panel() -> void:
	if battle_panel == null:
		return
	battle_panel.visible = not battle_panel.visible
	if battle_panel.visible:
		log_panel.visible = false
		intelligence_panel.visible = false
		deception_panel.visible = false
		_refresh_battle_panel()

func _toggle_intelligence_panel() -> void:
	if intelligence_panel == null:
		return
	intelligence_panel.visible = not intelligence_panel.visible
	if intelligence_panel.visible:
		log_panel.visible = false
		deception_panel.visible = false
		battle_panel.visible = false
		_refresh_intelligence_panel()

func _toggle_deception_panel() -> void:
	if deception_panel == null:
		return
	deception_panel.visible = not deception_panel.visible
	if deception_panel.visible:
		log_panel.visible = false
		intelligence_panel.visible = false
		battle_panel.visible = false
		_refresh_deception_panel()

func _on_speed_selected(index: int) -> void:
	if speed_option == null:
		return
	simulation_speed = max(1, int(speed_option.get_item_metadata(index)))
	_set_feedback("推演速度已切换为 %dx。" % simulation_speed, "info")
	_refresh()

func _toggle_running() -> void:
	running = not running
	if replay_mode:
		_set_feedback("回放%s。" % ("开始播放" if running else "已暂停"), "info")
		_refresh()
		return
	if engine_connected:
		_set_feedback("实时推进%s。" % ("已开始" if running else "已暂停"), "info")
		_refresh()
		return
	event_log.append(sim_time, "simulation_resumed" if running else "simulation_paused", {})
	_set_feedback("实时推演%s。" % ("已开始" if running else "已暂停"), "info")
	_refresh()

func _start_new_battle() -> void:
	if replay_mode:
		_set_feedback("回放模式不能建立新战局。", "error")
		return
	if engine_gateway == null or not engine_connected:
		_set_feedback("新战局未建立：实时内核未连接。", "error")
		return
	running = false
	engine_tick_accumulator = 0.0
	selected_target_area_id = ""
	map_notices = []
	engine_gateway.start_session("", true)
	_set_feedback("正在建立新的长平战局……", "info")
	_refresh()

func _issue_move() -> void:
	if replay_mode:
		_set_feedback("回放模式不能下达新命令。", "error")
		return
	if engine_connected:
		if selected_unit_id == "" or selected_target_area_id == "":
			_set_feedback("命令未提交：请先选择部队和目标区域。", "error")
			return
		engine_gateway.send_command({
			"type": "move",
			"unitId": selected_unit_id,
			"targetAreaId": selected_target_area_id,
			"recipientCommanderId": selected_commander_id,
		})
		_set_feedback("正在提交机动命令……", "info")
		return
	if not order.is_empty() and order.get("status", "") in ["transmitting", "executing"]:
		_set_feedback("命令未提交：当前部队已有命令正在传递或执行。", "error")
		return
	var unit_index: int = _unit_index(selected_unit_id)
	var unit: Dictionary = friendly_units[unit_index] if unit_index >= 0 else {}
	if unit.is_empty():
		_set_feedback("命令未提交：没有选中的己方部队。", "error")
		return
	if selected_target_area_id == "":
		_set_feedback("命令未提交：请先在沙盘选择目标区域。", "error")
		return
	var target: String = selected_target_area_id
	var travel_seconds: int = _travel_seconds(str(unit.get("areaId", "")), target)
	var command_delay := _command_delivery_delay()
	order = {
		"status": "transmitting",
		"type": "move",
		"unitId": unit.get("id", ""),
		"originAreaId": unit.get("areaId", ""),
		"targetAreaId": target,
		"deliverAt": sim_time + command_delay,
		"completeAt": sim_time + command_delay + travel_seconds,
		"issuedByCommanderId": player_commander_id,
		"recipientCommanderId": selected_commander_id,
		"communicationMode": _command_delivery_mode(),
		"route": [unit.get("areaId", ""), target],
		"totalTravelSeconds": travel_seconds,
		"remainingTravelSeconds": travel_seconds,
	}
	event_log.append(sim_time, "order_issued", {
		"unitId": unit.get("id", ""),
		"originAreaId": unit.get("areaId", ""),
		"targetAreaId": target,
		"deliverAt": order["deliverAt"],
		"completeAt": order["completeAt"],
		"travelSeconds": travel_seconds,
		"recipientCommanderId": selected_commander_id,
		"communicationMode": _command_delivery_mode(),
	})
	_add_log("已发令：%s向%s机动。" % [unit.get("name", "部队"), _area_name(target)])
	_set_feedback("命令已接收：%s向%s机动，正在传递。" % [unit.get("name", "部队"), _area_name(target)], "success")
	_refresh()

func _issue_hold() -> void:
	if replay_mode:
		_set_feedback("回放模式不能下达新命令。", "error")
		return
	if selected_unit_id == "":
		_set_feedback("坚守命令未提交：请先选择部队。", "error")
		return
	if engine_connected:
		engine_gateway.send_command({
			"type": "hold",
			"unitId": selected_unit_id,
			"recipientCommanderId": selected_commander_id,
		})
		_set_feedback("正在提交坚守命令……", "info")
		return
	if not order.is_empty() and order.get("status", "") in ["transmitting", "executing"]:
		_set_feedback("坚守命令未提交：当前部队已有命令正在传递或执行。", "error")
		return
	var unit_index: int = _unit_index(selected_unit_id)
	var unit: Dictionary = friendly_units[unit_index] if unit_index >= 0 else {}
	if unit.is_empty():
		_set_feedback("坚守命令未提交：没有选中的己方部队。", "error")
		return
	var command_delay := _command_delivery_delay()
	var deliver_at := sim_time + command_delay
	order = {
		"status": "transmitting",
		"type": "hold",
		"unitId": unit.get("id", ""),
		"originAreaId": unit.get("areaId", ""),
		"targetAreaId": unit.get("areaId", ""),
		"deliverAt": deliver_at,
		"completeAt": deliver_at + 1,
		"issuedByCommanderId": player_commander_id,
		"recipientCommanderId": selected_commander_id,
		"communicationMode": _command_delivery_mode(),
	}
	event_log.append(sim_time, "order_issued", {
		"type": "hold",
		"unitId": unit.get("id", ""),
		"originAreaId": unit.get("areaId", ""),
		"targetAreaId": unit.get("areaId", ""),
		"deliverAt": deliver_at,
			"completeAt": deliver_at + 1,
			"recipientCommanderId": selected_commander_id,
			"communicationMode": _command_delivery_mode(),
		})
	_add_log("已发令：%s坚守当前阵地。" % unit.get("name", "部队"))
	_set_feedback("坚守命令已接收：%s将在命令抵达后保持阵地。" % unit.get("name", "部队"), "success")
	_refresh()

func _on_task_selected(index: int) -> void:
	if task_option == null:
		return
	var task_type := str(task_option.get_item_metadata(index))
	_issue_task(task_type)

func _task_label(task_type: String) -> String:
	for task in TASK_COMMANDS:
		if str(task.get("type", "")) == task_type:
			return str(task.get("label", task_type))
	return task_type

func _issue_task(task_type: String) -> void:
	if replay_mode:
		_set_feedback("回放模式不能下达新任务。", "error")
		return
	if task_type == "":
		_set_feedback("任务未提交：没有选择任务类型。", "error")
		return
	if selected_unit_id == "":
		_set_feedback("任务未提交：请先选择部队。", "error")
		return
	var selected_unit_index: int = _unit_index(selected_unit_id)
	var selected_unit: Dictionary = friendly_units[selected_unit_index] if selected_unit_index >= 0 else {}
	if selected_unit.is_empty():
		_set_feedback("任务未提交：没有选中的己方部队。", "error")
		return
	var target_area := selected_target_area_id
	if target_area == "" and task_type == "guard":
		target_area = str(selected_unit.get("areaId", ""))
	if target_area == "":
		_set_feedback("任务未提交：请先在沙盘选择任务区域。", "error")
		return
	if engine_connected:
		engine_gateway.send_command({
			"type": task_type,
			"unitId": selected_unit_id,
			"targetAreaId": target_area,
			"recipientCommanderId": selected_commander_id,
		})
		_set_feedback("正在提交%s任务：目标%s……" % [_task_label(task_type), _area_name(target_area)], "info")
		return
	if not order.is_empty() and order.get("status", "") in ["transmitting", "executing"]:
		_set_feedback("任务未提交：当前部队已有命令正在传递或执行。", "error")
		return
	var travel_seconds: int = 0 if target_area == str(selected_unit.get("areaId", "")) else _travel_seconds(str(selected_unit.get("areaId", "")), target_area)
	var command_delay := _command_delivery_delay()
	var deliver_at := sim_time + command_delay
	order = {
		"status": "transmitting",
		"type": task_type,
		"taskType": task_type,
		"taskLabel": _task_label(task_type),
		"unitId": selected_unit_id,
		"originAreaId": selected_unit.get("areaId", ""),
		"targetAreaId": target_area,
		"deliverAt": deliver_at,
		"completeAt": deliver_at + max(1, travel_seconds),
		"issuedByCommanderId": player_commander_id,
		"recipientCommanderId": selected_commander_id,
		"communicationMode": _command_delivery_mode(),
		"route": [selected_unit.get("areaId", ""), target_area],
		"totalTravelSeconds": travel_seconds,
		"remainingTravelSeconds": travel_seconds,
	}
	event_log.append(sim_time, "order_issued", {
		"type": task_type,
		"taskType": task_type,
		"taskLabel": _task_label(task_type),
		"unitId": selected_unit_id,
		"originAreaId": selected_unit.get("areaId", ""),
		"targetAreaId": target_area,
		"deliverAt": deliver_at,
		"completeAt": order["completeAt"],
		"travelSeconds": travel_seconds,
		"recipientCommanderId": selected_commander_id,
		"communicationMode": _command_delivery_mode(),
	})
	_add_log("已发令：%s执行%s任务，目标%s。" % [selected_unit.get("name", "部队"), _task_label(task_type), _area_name(target_area)])
	_set_feedback("%s任务已接收：目标%s，命令正在传递。" % [_task_label(task_type), _area_name(target_area)], "success")
	_refresh()

func _submit_free_order(_submitted_text: String = "") -> void:
	if free_order_input == null:
		return
	var raw_text := free_order_input.text.strip_edges()
	if raw_text == "":
		_set_feedback("自由命令未提交：请先写下你的意图。", "error")
		return
	if engine_connected:
		engine_gateway.send_command({
			"type": "free_order",
			"text": raw_text,
			"unitId": selected_unit_id,
			"recipientCommanderId": selected_commander_id,
		})
		free_order_input.clear()
		_set_feedback("命令已接收：AI正在理解军令，并将其传给%s。" % _commander_name(selected_commander_id), "success")
		return
	var parsed: Dictionary = _parse_free_order(raw_text)
	if str(parsed.get("error", "")) != "":
		_set_feedback("自由命令未提交：%s" % str(parsed.get("error", "无法理解这道命令。")), "error")
		return
	var command: Dictionary = parsed.get("command", {}).duplicate(true)
	command["rawText"] = raw_text
	command["recipientCommanderId"] = selected_commander_id
	# The local fallback keeps the same commander affordance for offline UI checks.
	match str(command.get("type", "")):
		"move":
			selected_target_area_id = str(command.get("targetAreaId", ""))
			_issue_move()
		"hold":
			_issue_hold()
		"scout":
			_dispatch_scout()
		"deception":
			_issue_deception()
		_:
			if str(command.get("type", "")) in _task_types():
				selected_target_area_id = str(command.get("targetAreaId", selected_target_area_id))
				_issue_task(str(command.get("type", "")))
	free_order_input.clear()
	_refresh()

func _parse_free_order(raw_text: String) -> Dictionary:
	var lowered := raw_text.to_lower()
	if lowered.contains("侦察") or lowered.contains("侦查") or lowered.contains("斥候") or lowered.contains("探查"):
		return {"command": {"type": "scout"}}
	if lowered.contains("计策") or lowered.contains("谣言") or lowered.contains("欺骗") or lowered.contains("佯动") or lowered.contains("假情报"):
		var action_id := str(deception_actions[0].get("id", "")) if not deception_actions.is_empty() else ""
		if action_id == "":
			return {"error": "当前没有可用计策。"}
		for action in deception_actions:
			if raw_text.contains(str(action.get("name", ""))):
				action_id = str(action.get("id", action_id))
				break
		return {"command": {"type": "deception", "actionId": action_id}}

	var unit_id := _unit_from_order_text(raw_text)
	if unit_id == "":
		return {"error": "没有识别出要指挥的秦军部队，请写出‘秦军主力’或先在沙盘选中部队。"}
	var task_type := _task_type_from_order_text(lowered)
	if task_type != "":
		var task_target := _area_from_order_text(raw_text)
		if task_target == "":
			task_target = selected_target_area_id
		return {"command": {"type": task_type, "unitId": unit_id, "targetAreaId": task_target}}
	if lowered.contains("坚守") or lowered.contains("固守") or lowered.contains("防守") or lowered.contains("原地"):
		return {"command": {"type": "hold", "unitId": unit_id}}

	var target_area_id := _area_from_order_text(raw_text)
	if target_area_id == "" and selected_target_area_id != "":
		target_area_id = selected_target_area_id
	if target_area_id == "":
		return {"error": "没有识别出目标区域，请写出‘向丹水河谷机动’这类目标。"}
	return {"command": {"type": "move", "unitId": unit_id, "targetAreaId": target_area_id}}

func _task_types() -> Array:
	var types: Array = []
	for task in TASK_COMMANDS:
		types.append(str(task.get("type", "")))
	return types

func _task_type_from_order_text(lowered: String) -> String:
	if lowered.contains("警戒") or lowered.contains("戒备"):
		return "guard"
	if lowered.contains("掩护") or lowered.contains("保护"):
		return "cover"
	if lowered.contains("封锁") or lowered.contains("堵住"):
		return "blockade"
	if lowered.contains("诱敌") or lowered.contains("诱出"):
		return "decoy"
	if lowered.contains("截粮") or lowered.contains("断粮") or lowered.contains("粮道"):
		return "interdict_supply"
	if lowered.contains("撤退") or lowered.contains("退却") or lowered.contains("回撤"):
		return "retreat"
	return ""

func _unit_from_order_text(raw_text: String) -> String:
	for unit in friendly_units:
		if raw_text.contains(str(unit.get("name", ""))):
			return str(unit.get("id", ""))
	if raw_text.contains("主力"):
		return "qin-main"
	if raw_text.contains("机动") or raw_text.contains("偏师") or raw_text.contains("右翼") or raw_text.contains("左翼"):
		return "qin-detachment"
	return selected_unit_id

func _area_from_order_text(raw_text: String) -> String:
	var aliases := {
		"qin-west-camp": ["西营", "西侧营垒"],
		"western-gate": ["西口", "关口", "长平西口"],
		"dan-river-valley": ["丹水", "河谷"],
		"zhao-main-camp": ["赵军壁垒", "主壁", "壁垒"],
		"zhao-relief-route": ["援军通道", "援军方向", "援军"],
		"east-highland": ["东侧高地", "高地"],
	}
	for area in scenario.get("areas", []):
		var area_id := str(area.get("id", ""))
		var area_name := str(area.get("name", ""))
		var short_name := area_name.split("（")[0]
		if raw_text.contains(area_name) or raw_text.contains(short_name):
			return area_id
		for alias in aliases.get(area_id, []):
			if raw_text.contains(alias):
				return area_id
	return ""

func _dispatch_scout() -> void:
	if replay_mode:
		_set_feedback("回放模式不能派出新的侦察。", "error")
		return
	if engine_connected:
		engine_gateway.send_command({
			"type": "scout",
			"commandUnitId": _command_unit_for_selected_commander(),
			"recipientCommanderId": selected_commander_id,
		})
		_set_feedback("正在派出前出斥候……", "info")
		return
	if _pending_observation_count() > 0:
		_set_feedback("侦察未派出：已有一份报告正在返回。", "error")
		return
	var scout: Dictionary = scenario.get("scout", {})
	if scout.is_empty():
		_set_feedback("侦察未派出：当前战役没有配置侦察方式。", "error")
		return
	if not _can_afford(scout.get("cost", {})):
		_set_feedback("侦察未派出：侦察资源不足。", "error")
		return
	_spend_resources(scout.get("cost", {}))
	pending_scout = scout.duplicate(true)
	var preparation_seconds := int(scout.get("preparationSeconds", 0))
	pending_scout["preparationAt"] = sim_time + preparation_seconds
	pending_scout["arrivesAt"] = sim_time + preparation_seconds + int(scout.get("delaySeconds", 5))
	pending_scout["status"] = "preparing" if preparation_seconds > 0 else "in_transit"
	pending_observations = [pending_scout.duplicate(true)]
	event_log.append(sim_time, "observation_queued", {
		"reportedAreaId": scout.get("reportedAreaId", ""),
		"sourceType": scout.get("sourceType", "前出斥候"),
		"confidence": scout.get("confidence", "medium"),
		"arrivesAt": pending_scout["arrivesAt"],
	})
	_add_log("前出斥候已接收军令，正在整备。")
	_set_feedback("侦察已接收：斥候准备%s，资源已扣除。" % _format_duration(preparation_seconds), "success")
	_refresh()

func _issue_deception() -> void:
	if replay_mode or not engine_connected or deception_actions.is_empty():
		_set_feedback("计策未执行：需要连接实时内核并拥有可用计策。", "error")
		return
	_toggle_deception_panel()

func _on_deception_action_selected(action_id: String) -> void:
	if replay_mode or not engine_connected:
		_set_feedback("计策未执行：需要连接实时内核。", "error")
		return
	if engine_gateway != null and engine_gateway.busy():
		_set_feedback("计策未执行：上一条命令仍在传递。", "error")
		return
	var selected_action: Dictionary = {}
	for action_value in deception_actions:
		if action_value is Dictionary and str(action_value.get("id", "")) == action_id:
			selected_action = action_value
			break
	if selected_action.is_empty():
		_set_feedback("计策未执行：这项计策已不在当前战局。", "error")
		return
	if not _can_afford(selected_action.get("cost", {})):
		_set_feedback("计策未执行：资源不足。", "error")
		return
	selected_deception_action_id = action_id
	deception_panel.visible = false
	engine_gateway.send_command({
		"type": "deception",
		"actionId": selected_action.get("id", ""),
		"targetUnitId": selected_action.get("targetUnitId", selected_unit_id),
		"reportedAreaId": selected_action.get("reportedAreaId", ""),
		"recipientCommanderId": selected_commander_id,
	})
	_set_feedback("正在提交计策：%s。敌方将收到一份可能失真的报告……" % str(selected_action.get("name", "计策")), "info")

func _refresh_battle_panel() -> void:
	if battle_label == null:
		return
	var lines: Array[String] = []
	var commander_name := _commander_name(player_commander_id)
	lines.append("统帅：%s · 秦军" % commander_name)
	lines.append("当前身份：战役指挥官")
	lines.append("")
	var resolution_value = scenario.get("resolution", {})
	var resolution: Dictionary = resolution_value if resolution_value is Dictionary else {}
	var time_limit := int(resolution.get("timeLimitSeconds", 0))
	if time_limit > 0:
		lines.append("时间压力：剩余 %s" % _format_duration(max(0, time_limit - sim_time)))
	else:
		lines.append("时间压力：未设置本局上限")
	lines.append("战局状态：%s" % ("已结束" if outcome.size() > 0 else ("实时内核" if engine_connected else "本地推演")))
	lines.append("")
	lines.append("统帅层战役意图")
	var visible_objective_count := 0
	for objective_value in objectives:
		if not objective_value is Dictionary:
			continue
		var objective: Dictionary = objective_value
		var objective_side := str(objective.get("side", "player"))
		if objective_side != "" and objective_side != "player":
			continue
		lines.append("· %s" % str(objective.get("name", "未命名意图")))
		visible_objective_count += 1
	if visible_objective_count == 0:
		lines.append("· 当前战役意图由前线态势决定。")
	var resolution_state_value = resolution_state
	if resolution_state_value.is_empty():
		var scenario_resolution_value = scenario.get("resolution", {})
		resolution_state_value = scenario_resolution_value if scenario_resolution_value is Dictionary else {}
	var victory_state_value = resolution_state_value.get("victory", {})
	var victory_state: Dictionary = victory_state_value if victory_state_value is Dictionary else {}
	var required_task_effects_value = victory_state.get("requiredTaskEffects", [])
	if required_task_effects_value is Array and not required_task_effects_value.is_empty():
		lines.append("")
		lines.append("当前胜利门槛")
		for effect_value in required_task_effects_value:
			if not effect_value is Dictionary:
				continue
			var effect: Dictionary = effect_value
			var effect_status := "已建立" if str(effect.get("status", "pending")) == "achieved" else "待建立"
			lines.append("· %s：%s" % [_task_label(str(effect.get("type", ""))), effect_status])
	var required_hold := int(victory_state.get("requiredHoldSeconds", 0))
	if required_hold > 0:
		var hold_elapsed := int(victory_state.get("holdElapsedSeconds", 0))
		var hold_status := str(victory_state.get("holdStatus", "not_started"))
		lines.append("· 态势确认：%s" % _hold_status_text(hold_status, hold_elapsed, required_hold))
	lines.append("")
	lines.append("可用资源")
	lines.append("情报点 %s · 斥候队 %s · 计策资源 %s" % [_resource_text("intelligencePoints"), _resource_text("scoutTeams"), _resource_text("deceptionAssets")])
	lines.append("情报链可信度：%d%%" % int(strategy_reliability * 100.0))
	if outcome.size() > 0:
		lines.append("")
		lines.append("战后复盘")
		var result_label := str(review.get("resultLabel", outcome.get("result", "战役结束")))
		var reason_label := str(review.get("reasonLabel", outcome.get("reason", "")))
		lines.append("结果：%s" % result_label)
		if reason_label != "":
			lines.append("原因：%s" % reason_label)
		var stats_value = review.get("stats", {})
		var stats: Dictionary = stats_value if stats_value is Dictionary else {}
		lines.append("命令 %d · 情报 %d · 计策 %d" % [int(stats.get("commandCount", 0)), int(stats.get("reportCount", 0)), int(stats.get("deceptionCount", 0))])
		lines.append("这份复盘只记录指挥官已知事件，不回填隐藏战斗真值。")
	lines.append("")
	lines.append("提示：地图只显示我方已知信息和延迟报告；敌军真值不会直接显示。")
	battle_label.text = "\n".join(lines)

func _refresh_intelligence_panel() -> void:
	if intelligence_label == null:
		return
	var lines: Array[String] = ["只显示已经传回的认知，不代表敌军真实位置。", ""]
	if pending_observations.is_empty() and reported_signals.is_empty():
		lines.append("当前没有前线情报。")
	else:
		for pending_value in pending_observations:
			if not pending_value is Dictionary:
				continue
			var pending: Dictionary = pending_value
			var pending_area := _area_name(str(pending.get("reportedAreaId", "")))
			var pending_seconds := int(pending.get("remainingSeconds", int(pending.get("arrivesAt", sim_time)) - sim_time))
			lines.append("【回传中】%s" % pending_area)
			lines.append("来源：%s · 预计还需%s" % [str(pending.get("sourceType", "前线报告")), _format_duration(max(0, pending_seconds))])
			lines.append("")
		for report_value in reported_signals:
			if not report_value is Dictionary:
				continue
			var report: Dictionary = report_value
			var area_id := str(report.get("areaId", report.get("reportedAreaId", "")))
			var confidence := str(report.get("confidence", "unknown"))
			var uncertainty_value = report.get("uncertainty", {})
			var uncertainty: Dictionary = uncertainty_value if uncertainty_value is Dictionary else {}
			var expires_at := int(report.get("expiresAt", sim_time))
			lines.append("【%s】%s" % [_confidence_label(confidence), _area_name(area_id)])
			lines.append("来源：%s · %s" % [str(report.get("sourceType", "前线报告")), _uncertainty_label({"uncertainty": uncertainty, "confidence": confidence})])
			lines.append("有效剩余：%s" % _format_duration(max(0, expires_at - sim_time)))
			lines.append(str(report.get("text", report.get("observation", "发现活动迹象"))))
			lines.append("")
	intelligence_label.text = "\n".join(lines)

func _refresh_deception_panel() -> void:
	if deception_list == null:
		return
	for child in deception_list.get_children():
		deception_list.remove_child(child)
		child.free()
	if deception_hint_label != null:
		deception_hint_label.text = "选择一项：有成本、有准备时间，也可能暴露。"
	if deception_actions.is_empty():
		_add_label(deception_list, "当前没有可用计策。", Rect2(0, 0, 292, 28), 11, Color("#d7c5ac"))
		return
	for action_value in deception_actions:
		if not action_value is Dictionary:
			continue
		var action: Dictionary = action_value
		var action_id := str(action.get("id", ""))
		var action_name := str(action.get("name", "未命名计策"))
		var preparation_seconds := int(action.get("preparationSeconds", 0))
		var cost_text := _cost_text(action.get("cost", {}))
		var target_name := _area_name(str(action.get("reportedAreaId", "")))
		var action_button := Button.new()
		action_button.text = "%s\n准备%s · %s · 目标 %s" % [action_name, _format_duration(preparation_seconds), cost_text, target_name]
		action_button.tooltip_text = "选择%s" % action_name
		action_button.custom_minimum_size = Vector2(292, 58)
		action_button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_style_button(action_button, action_id == selected_deception_action_id)
		action_button.disabled = replay_mode or outcome.size() > 0 or not _can_afford(action.get("cost", {})) or (engine_gateway != null and engine_gateway.busy())
		action_button.pressed.connect(_on_deception_action_selected.bind(action_id))
		deception_list.add_child(action_button)

func _cost_text(cost: Variant) -> String:
	if not cost is Dictionary or cost.is_empty():
		return "无消耗"
	var parts: Array[String] = []
	for key in cost.keys():
		parts.append("%s-%d" % [_resource_label(str(key)), int(cost[key])])
	return "、".join(parts)

func _resource_label(resource_key: String) -> String:
	match resource_key:
		"intelligencePoints": return "情报点"
		"scoutTeams": return "斥候队"
		"deceptionAssets": return "计策资源"
		_: return resource_key

func _format_duration(total_seconds: int) -> String:
	var seconds: int = max(0, total_seconds)
	var seconds_per_ke := int(scenario.get("calendar", {}).get("secondsPerKe", 900))
	if seconds == 0:
		return "此刻"
	if seconds < seconds_per_ke:
		return "少顷"
	var ke := int(ceil(float(seconds) / float(seconds_per_ke)))
	if ke < 8:
		return "%d刻" % ke
	var shichen := int(ceil(float(seconds) / 7200.0))
	if shichen < 12:
		return "%d个时辰" % shichen
	return "%d日内" % int(ceil(float(seconds) / 86400.0))

func _historical_time_label() -> String:
	var calendar_value = scenario.get("calendar", {})
	if not calendar_value is Dictionary or calendar_value.is_empty():
		return "战时未定"
	var calendar: Dictionary = calendar_value
	var start_value = calendar.get("start", {})
	var start: Dictionary = start_value if start_value is Dictionary else {}
	var absolute_seconds := int(start.get("secondOfDay", 0)) + sim_time
	var elapsed_days := int(absolute_seconds / 86400)
	var second_of_day := absolute_seconds % 86400
	var month := int(start.get("month", 1))
	var day := int(start.get("day", 1))
	var month_lengths: Array = calendar.get("monthLengths", [30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, 29])
	for _index in range(elapsed_days):
		day += 1
		var month_length := int(month_lengths[month - 1]) if month - 1 < month_lengths.size() else 30
		if day > month_length:
			day = 1
			month = 1 if month >= month_lengths.size() else month + 1
	var names: Array = calendar.get("shichenNames", ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"])
	var shifted := (second_of_day + 3600) % 86400
	var shichen_index := int(shifted / 7200)
	var ke := int((shifted % 7200) / int(calendar.get("secondsPerKe", 900)))
	var ke_label := "初刻" if ke == 0 else ("正刻" if ke == 4 else "%d刻" % ke)
	return "%s %d月%d日 · %s时%s" % [str(calendar.get("eraLabel", "")), month, day, str(names[shichen_index]), ke_label]

func _hold_status_text(status: String, elapsed: int, required: int) -> String:
	match status:
		"holding": return "维持中 %s / %s" % [_format_duration(elapsed), _format_duration(required)]
		"broken": return "已中断，需重新建立"
		_: return "待完成部署后开始确认"

func _step_second() -> void:
	sim_time += 1
	if not order.is_empty():
		if order.get("status", "") == "transmitting" and sim_time >= int(order.get("deliverAt", 0)):
			order["status"] = "executing"
			event_log.append(sim_time, "order_delivered", {
				"unitId": order.get("unitId", ""),
				"targetAreaId": order.get("targetAreaId", ""),
			})
			var delivery_action := "坚守当前阵地"
			if order.get("taskType", "") != "":
				delivery_action = "执行%s" % str(order.get("taskLabel", "任务"))
			elif order.get("type", "move") != "hold":
				delivery_action = "开始执行机动"
			_add_log("命令抵达：部队%s。" % delivery_action)
			_set_feedback("命令已抵达：%s开始执行。" % delivery_action, "info")
		if order.get("status", "") == "executing" and order.get("type", "move") == "hold":
			order["status"] = "completed"
			event_log.append(sim_time, "order_completed", {
				"unitId": order.get("unitId", ""),
				"areaId": order.get("targetAreaId", ""),
			})
			_add_log("命令执行：部队坚守当前阵地。")
		if order.get("status", "") == "executing" and order.get("type", "move") != "hold" and sim_time >= int(order.get("completeAt", 0)):
			var unit_index: int = _unit_index(str(order.get("unitId", "")))
			if unit_index >= 0:
				friendly_units[unit_index]["areaId"] = order.get("targetAreaId", "")
				if order.get("taskType", "") != "":
					friendly_units[unit_index]["posture"] = order.get("taskType", "standard")
			order["status"] = "completed"
			event_log.append(sim_time, "unit_arrived", {
				"unitId": order.get("unitId", ""),
				"areaId": order.get("targetAreaId", ""),
			})
			if order.get("taskType", "") != "":
				_add_log("部队到达：已进入%s，%s任务生效。" % [_area_name(str(order.get("targetAreaId", ""))), str(order.get("taskLabel", "任务"))])
			else:
				_add_log("部队到达：已进入%s。" % _area_name(str(order.get("targetAreaId", ""))))
			_set_feedback("部队已抵达：%s。" % _area_name(str(order.get("targetAreaId", ""))), "success")
		elif order.get("status", "") == "executing" and order.get("type", "move") != "hold":
			order["remainingTravelSeconds"] = max(0, int(order.get("remainingTravelSeconds", 0)) - 1)

	if not pending_scout.is_empty() and pending_scout.get("status", "in_transit") == "preparing" and sim_time >= int(pending_scout.get("preparationAt", 0)):
		pending_scout["status"] = "in_transit"
		pending_observations = [pending_scout.duplicate(true)]
		event_log.append(sim_time, "reconnaissance_prepared", {})
		_add_log("侦察准备完成，斥候已出发。")
	if not pending_scout.is_empty() and pending_scout.get("status", "in_transit") == "in_transit" and sim_time >= int(pending_scout.get("arrivesAt", 0)):
		var report := {
			"id": "report-%04d" % (reported_signals.size() + 1),
			"areaId": pending_scout.get("reportedAreaId", ""),
			"confidence": pending_scout.get("confidence", "medium"),
			"sourceType": pending_scout.get("sourceType", "前出斥候"),
			"text": pending_scout.get("observation", "发现敌情"),
			"expiresAt": sim_time + int(pending_scout.get("freshnessSeconds", 24)),
			"uncertainty": pending_scout.get("uncertainty", {"level": pending_scout.get("confidence", "medium"), "radiusNormalized": _report_radius_normalized(str(pending_scout.get("confidence", "medium")))}),
		}
		reported_signals.append(report)
		pending_scout = {}
		pending_observations = []
		event_log.append(sim_time, "report_arrived", {
			"reportId": report["id"],
			"reportedAreaId": report["areaId"],
			"sourceType": report["sourceType"],
			"confidence": report["confidence"],
			"text": report["text"],
			"uncertainty": report["uncertainty"],
			"expiresAt": report["expiresAt"],
		})
		_add_log("情报抵达：赵军援军疑似位于主壁方向。")
		_set_feedback("前线情报抵达：赵军援军疑似位于主壁方向。", "success")

	for index in range(reported_signals.size() - 1, -1, -1):
		if sim_time >= int(reported_signals[index].get("expiresAt", 999999)):
			_add_map_notice("report_expired", str(reported_signals[index].get("areaId", "")), "情报失效", 12)
			event_log.append(sim_time, "report_expired", {
				"reportId": reported_signals[index].get("id", ""),
				"reportedAreaId": reported_signals[index].get("areaId", ""),
			})
			reported_signals.remove_at(index)
			_add_log("情报失效：前方敌情标记超过有效时限。")
			_set_feedback("前线情报已失效：沙盘上的疑似敌情已移除。", "info")

	_refresh()

func _travel_seconds(from_area: String, to_area: String) -> int:
	for area in scenario.get("areas", []):
		if area.get("id", "") != from_area:
			continue
		for neighbor in area.get("neighbors", []):
			if neighbor.get("id", "") == to_area:
				return int(neighbor.get("travelSeconds", 10))
	return 10

func _unit_index(unit_id: String) -> int:
	for index in range(friendly_units.size()):
		if friendly_units[index].get("id", "") == unit_id:
			return index
	return -1

func _commander_by_id(commander_id: String) -> Dictionary:
	for commander_value in commanders:
		if commander_value is Dictionary and str(commander_value.get("id", "")) == commander_id:
			return commander_value
	return {}

func _commander_id_for_unit(unit_id: String) -> String:
	for unit_value in friendly_units:
		if unit_value is Dictionary and str(unit_value.get("id", "")) == unit_id:
			var commander_id := str(unit_value.get("commanderId", ""))
			if commander_id != "":
				return commander_id
	return player_commander_id

func _commander_name(commander_id: String) -> String:
	var commander := _commander_by_id(commander_id)
	return str(commander.get("name", "前线军官")) if not commander.is_empty() else "前线军官"

func _commander_area(commander_id: String) -> String:
	var commander := _commander_by_id(commander_id)
	if commander.is_empty():
		return ""
	var attached_unit_id := str(commander.get("attachedUnitId", ""))
	if attached_unit_id != "":
		var attached_index := _unit_index(attached_unit_id)
		if attached_index >= 0:
			return str(friendly_units[attached_index].get("areaId", ""))
	return str(commander.get("locationAreaId", ""))

func _commander_location_text(commander_id: String) -> String:
	var commander := _commander_by_id(commander_id)
	if commander.is_empty():
		return "位置未知"
	var area_id := _commander_area(commander_id)
	var area_name := _area_name(area_id) if area_id != "" else "位置未知"
	var attached_unit_id := str(commander.get("attachedUnitId", ""))
	if attached_unit_id != "":
		var attached_index := _unit_index(attached_unit_id)
		if attached_index >= 0:
			return "随%s · %s" % [str(friendly_units[attached_index].get("name", "部队")), area_name]
	return "指挥所 · %s" % area_name

func _command_delivery_mode() -> String:
	if commanders.is_empty():
		return "legacy"
	var issuer_area := _commander_area(player_commander_id)
	var recipient_area := _commander_area(selected_commander_id)
	if issuer_area != "" and issuer_area == recipient_area:
		return "direct"
	return "messenger"

func _command_delivery_delay() -> int:
	if commanders.is_empty():
		return int(scenario.get("commandDelaySeconds", 3))
	if _command_delivery_mode() == "direct":
		return 0
	var chain_value = scenario.get("commandChain", {})
	var chain: Dictionary = chain_value if chain_value is Dictionary else {}
	var policy_value = chain.get("messengerPolicy", {})
	var policy: Dictionary = policy_value if policy_value is Dictionary else {}
	var base_delay := int(policy.get("baseDelaySeconds", 1))
	var route_factor := float(policy.get("routeTravelFactor", 0.25))
	var fallback_delay := int(policy.get("fallbackDelaySeconds", scenario.get("commandDelaySeconds", 3)))
	var issuer_area := _commander_area(player_commander_id)
	var recipient_area := _commander_area(selected_commander_id)
	if issuer_area == "" or recipient_area == "":
		return fallback_delay
	var travel_seconds := _travel_seconds(issuer_area, recipient_area)
	return base_delay + max(1, int(ceil(float(travel_seconds) * route_factor)))

func _command_unit_for_selected_commander() -> String:
	var commander := _commander_by_id(selected_commander_id)
	var attached_unit_id := str(commander.get("attachedUnitId", ""))
	return attached_unit_id if attached_unit_id != "" else selected_unit_id

func _on_commander_selected(index: int) -> void:
	if commander_option == null:
		return
	selected_commander_id = str(commander_option.get_item_metadata(index))
	var commander := _commander_by_id(selected_commander_id)
	var attached_unit_id := str(commander.get("attachedUnitId", ""))
	if attached_unit_id != "" and _unit_index(attached_unit_id) >= 0:
		selected_unit_id = attached_unit_id
	event_log.append(sim_time, "commander_recipient_selected", {"commanderId": selected_commander_id})
	_add_log("接收军官已选：%s（%s）。" % [_commander_name(selected_commander_id), _commander_location_text(selected_commander_id)])
	_set_feedback("接收军官已选：%s。%s" % [_commander_name(selected_commander_id), "将派传令兵" if _command_delivery_mode() == "messenger" else "可当面传令"], "info")
	_refresh()

func _on_unit_selected(unit_id: String) -> void:
	if replay_mode:
		return
	selected_unit_id = unit_id
	var unit_commander_id := _commander_id_for_unit(unit_id)
	if unit_commander_id != "":
		selected_commander_id = unit_commander_id
	event_log.append(sim_time, "commander_unit_selected", {"unitId": unit_id})
	var unit_index: int = _unit_index(unit_id)
	if unit_index >= 0:
		_add_log("已选中：%s。" % friendly_units[unit_index].get("name", "部队"))
		_set_feedback("已选中：%s。现在请选择目标区域。" % friendly_units[unit_index].get("name", "部队"), "info")
		_refresh()

func _on_area_selected(area_id: String) -> void:
	if replay_mode:
		return
	selected_target_area_id = area_id
	event_log.append(sim_time, "commander_target_selected", {"areaId": area_id})
	_add_log("目标区域已选：%s。" % _area_name(area_id))
	_set_feedback("目标已选：%s。点击机动按钮后命令才会提交。" % _area_name(area_id), "info")
	_refresh()

func _area_name(area_id: String) -> String:
	for area in scenario.get("areas", []):
		if area.get("id", "") == area_id:
			return str(area.get("name", area_id))
	return area_id

func _set_zoom(value: float) -> void:
	var next_zoom: float = clamp(value, 0.75, 1.8)
	map_camera.zoom = Vector2(next_zoom, next_zoom)
	if zoom_label != null:
		zoom_label.text = "%d%%" % int(next_zoom * 100.0)

func _reset_view() -> void:
	map_camera.position = Vector2(640, 360)
	_set_zoom(1.0)

func _export_replay() -> void:
	if replay_mode:
		return
	if engine_connected:
		_export_engine_replay()
		return
	var path := "user://changping-replay.json"
	event_log.append(sim_time, "replay_exported", {"path": path})
	var result: int = event_log.save_to(path)
	if result == OK:
		_add_log("回放已导出：记录了 %d 个游戏事件。" % event_log.events.size())
	else:
		_add_log("回放导出失败，请检查存储权限。")
	_refresh()

func _export_engine_replay() -> void:
	var snapshot := {
		"schemaVersion": 1,
		"scenarioId": engine_session.get("scenarioId", scenario.get("sourceScenarioId", "changping-260")),
		"events": engine_session.get("eventLog", []).duplicate(true),
		"disclosure": {
			"rawEnemyTruthIncluded": false,
			"combatExchangeIncluded": false,
			"source": "commander-event-stream",
		},
	}
	var file := FileAccess.open("user://changping-replay.json", FileAccess.WRITE)
	if file == null:
		_add_log("通用内核回放导出失败，请检查存储权限。")
	else:
		file.store_string(JSON.stringify(snapshot, "\t"))
		_add_log("通用内核回放已导出：记录了 %d 个游戏事件。" % snapshot.events.size())
	_refresh()

func _load_replay() -> void:
	var snapshot := EventLog.load_snapshot("user://changping-replay.json")
	if snapshot.is_empty():
		_add_log("没有找到上一局回放，请先完成一次导出。")
		_refresh()
		return
	var validation := replay_player.load_snapshot(snapshot, str(scenario.get("sourceScenarioId", "changping-260")))
	if validation != "":
		_add_log("回放无法载入：%s" % validation)
		_refresh()
		return
	replay_mode = true
	running = false
	replay_accumulator = 0.0
	replay_player.seek(0)
	_apply_replay_state(replay_player.current_state())
	_add_log("已载入上一局回放：历时%s。" % _format_duration(replay_player.duration()))
	_refresh()

func _exit_replay() -> void:
	replay_mode = false
	running = false
	replay_accumulator = 0.0
	sim_time = 0
	friendly_units = scenario.get("friendlyUnits", []).duplicate(true)
	selected_unit_id = str(friendly_units[0].get("id", "")) if not friendly_units.is_empty() else ""
	selected_commander_id = _commander_id_for_unit(selected_unit_id)
	if selected_commander_id == "":
		selected_commander_id = player_commander_id
	selected_target_area_id = ""
	reported_signals = []
	map_notices = []
	order = {}
	pending_scout = {}
	pending_observations = []
	outcome = {}
	objectives = scenario.get("objectives", []).duplicate(true)
	var replay_session_value = scenario.get("commanderSession", {})
	if replay_session_value is Dictionary:
		var replay_session: Dictionary = replay_session_value
		var replay_resolution_value = replay_session.get("resolution", {})
		resolution_state = replay_resolution_value.duplicate(true) if replay_resolution_value is Dictionary else {}
	review = {}
	log_lines = []
	event_log = EventLog.new()
	event_log.configure(str(scenario.get("sourceScenarioId", "changping-260")))
	event_log.append(0, "scenario_loaded", {"commanderSide": "qin", "rawEnemyTruthIncluded": false})
	replay_player.configure(friendly_units, selected_unit_id)
	_add_log("已退出回放，重新开始本局战役。")
	_refresh()

func _step_replay_second() -> void:
	var current_time := int(replay_player.current_state().get("simTime", 0))
	var target_time: int = min(current_time + 1, replay_player.duration())
	_apply_replay_state(replay_player.advance_to(target_time))
	if target_time >= replay_player.duration():
		running = false
		_add_log("回放播放完毕。")
	_refresh()

func _on_replay_slider_changed(value: float) -> void:
	if not replay_mode:
		return
	running = false
	_apply_replay_state(replay_player.seek(int(value)))
	_refresh()

func _apply_replay_state(replay_state: Dictionary) -> void:
	sim_time = int(replay_state.get("simTime", 0))
	var replay_units = replay_state.get("friendlyUnits", [])
	friendly_units = replay_units.duplicate(true) if replay_units is Array else []
	var replay_reports = replay_state.get("reportedSignals", [])
	reported_signals = replay_reports.duplicate(true) if replay_reports is Array else []
	var replay_order = replay_state.get("order", {})
	order = replay_order.duplicate(true) if replay_order is Dictionary else {}
	var replay_pending = replay_state.get("pendingObservation", {})
	pending_scout = replay_pending.duplicate(true) if replay_pending is Dictionary else {}
	pending_observations = [pending_scout.duplicate(true)] if not pending_scout.is_empty() else []
	var replay_outcome = replay_state.get("outcome", {})
	outcome = replay_outcome.duplicate(true) if replay_outcome is Dictionary else {}
	selected_unit_id = str(replay_state.get("selectedUnitId", selected_unit_id))
	var replay_commander_id := _commander_id_for_unit(selected_unit_id)
	if replay_commander_id != "":
		selected_commander_id = replay_commander_id
	selected_target_area_id = str(replay_state.get("selectedTargetAreaId", selected_target_area_id))
	log_lines = []
	for event in replay_state.get("timeline", []):
		_add_log(_replay_event_text(event))

func _replay_event_text(event: Dictionary) -> String:
	var payload: Dictionary = event.get("payload", {})
	match str(event.get("type", "")):
		"order_issued":
			if str(payload.get("taskLabel", "")) != "":
				return "回放：已发令，部队执行%s任务，目标%s。" % [str(payload.get("taskLabel", "任务")), _area_name(str(payload.get("targetAreaId", "")))]
			return "回放：已发令，部队向%s机动。" % _area_name(str(payload.get("targetAreaId", "")))
		"order_delivered":
			return "回放：命令抵达，部队开始执行。"
		"command_delivered":
			return "回放：传令抵达，接收军官收到军令。"
		"officer_decision":
			return "回放：%s。" % _officer_decision_feedback(event)
		"officer_route_changed":
			return "回放：%s。" % _officer_route_feedback(event)
		"officer_delay_completed":
			return "回放：副将整备完成，部队恢复执行。"
		"command_interpreted":
			return "回放：AI完成军令识别，已交给接收军官。"
		"unit_arrived":
			return "回放：部队抵达%s。" % _area_name(str(payload.get("areaId", payload.get("targetAreaId", ""))))
		"unit_entered_terrain":
			return "回放：部队进入%s。" % str(payload.get("label", "地形"))
		"unit_exited_terrain":
			return "回放：部队完成%s。" % str(payload.get("label", "地形通过"))
		"observation_queued":
			return "回放：前出斥候报告正在返回。"
		"observation_created":
			if str(payload.get("sourceType", "")) == "frontline-report":
				return "回放：前线来报正在返回，疑似敌军调动。"
			return "回放：侦察报告正在返回指挥部。"
		"reconnaissance_issued": return "回放：侦察已接收，斥候正在准备。"
		"reconnaissance_command_delivered": return "回放：侦察军令抵达，前线副将开始整备。"
		"reconnaissance_prepared": return "回放：斥候准备完成，已出发。"
		"reconnaissance_exposed": return "回放：斥候行迹暴露，回报可信度下降。"
		"reconnaissance_dispatched": return "回放：侦察报告正在返回指挥部。"
		"report_arrived":
			return "回放：情报抵达，敌情位于%s（%s，%s）。" % [_area_name(str(payload.get("reportedAreaId", payload.get("areaId", "")))), _confidence_label(str(payload.get("confidence", "unknown"))), _uncertainty_label(payload)]
		"report_expired":
			return "回放：前线情报失效。"
		"deception_issued":
			if str(payload.get("status", "")) == "preparing":
				return "回放：计策已接收，正在准备投放。"
			return "回放：已施行计策，敌方将依据自己的认知行动。"
		"deception_prepared": return "回放：计策准备完成，正在投放。"
		"deception_command_delivered": return "回放：计策军令抵达，前线开始准备。"
		"deception_exposed": return "回放：计策暴露，后续误导可信度下降。"
		"strategy_reliability_reduced": return "回放：情报链可信度下降。"
		"victory_hold_started": return "回放：隔离态势已建立，进入确认窗口。"
		"victory_hold_broken": return "回放：隔离态势中断，需要重新建立。"
		"commander_unit_selected":
			return "回放：选中部队。"
		"commander_target_selected":
			return "回放：选定%s为目标。" % _area_name(str(payload.get("areaId", "")))
		"replay_exported":
			return "回放：导出记录。"
		"battle_ended":
			return "回放：战役结束（%s）。" % str(payload.get("result", event.get("result", "unknown")))
		_:
			return "回放：%s。" % str(event.get("type", "未知事件"))

func _confidence_label(confidence: String) -> String:
	match confidence:
		"high": return "高可信"
		"low": return "低可信"
		_: return "中可信"

func _uncertainty_label(payload: Dictionary) -> String:
	var uncertainty_value = payload.get("uncertainty", {})
	var uncertainty: Dictionary = uncertainty_value if uncertainty_value is Dictionary else {}
	var label := str(uncertainty.get("label", ""))
	if label != "":
		return label
	match str(uncertainty.get("level", payload.get("confidence", "unknown"))):
		"high": return "误差较小"
		"low": return "可能偏离附近区域"
		_: return "可能偏离相邻区域"

func _report_radius_normalized(level: String) -> float:
	match level:
		"high": return 0.04
		"medium": return 0.09
		"low": return 0.16
		_: return 0.2

func _add_log(message: String) -> void:
	log_lines.push_front("[%s] %s" % [_historical_time_label(), message])
	if log_lines.size() > 12:
		log_lines.pop_back()

func _set_feedback(message: String, tone: String = "info") -> void:
	if feedback_label == null:
		return
	feedback_label.text = "最近操作\n" + message
	match tone:
		"success": feedback_label.add_theme_color_override("font_color", Color("#b8d2a4"))
		"error": feedback_label.add_theme_color_override("font_color", Color("#e0a08b"))
		_: feedback_label.add_theme_color_override("font_color", Color("#e4c58e"))

func _refresh() -> void:
	if clock_label == null:
		return
	clock_label.text = _historical_time_label()
	if guide_label != null:
		guide_label.text = _guide_text()
	var mode := "战场推演中" if running else "战场已暂停"
	if engine_connected and not replay_mode:
		mode = "战场推演中" if running else "战场已暂停"
	if outcome.size() > 0:
		mode = "战役已结束"
	elif replay_mode:
		mode = "回放播放中" if running else "回放已暂停"
	var order_status: String = _order_status_text(str(order.get("status", ""))) if not order.is_empty() else "暂无军令"
	var report_status := "%d 条前线报告" % reported_signals.size()
	var pending_count := _pending_observation_count()
	var preparation_count := _preparing_strategy_count()
	var pending_status := " · %d 份回传中 · %d 项准备中" % [pending_count, preparation_count]
	status_label.text = "%s\n军令：%s · %s%s" % [mode, order_status, report_status, pending_status]
	if hud_metrics_label != null:
		hud_metrics_label.text = "秦军 %d 部  ·  情报 %s  ·  斥候 %s\n计策 %s  ·  情报链 %d%%" % [friendly_units.size(), _resource_text("intelligencePoints"), _resource_text("scoutTeams"), _resource_text("deceptionAssets"), int(strategy_reliability * 100.0)]
	command_state_label.text = _command_state_text()
	if commander_option != null and not commanders.is_empty():
		for index in range(commander_option.item_count):
			if str(commander_option.get_item_metadata(index)) == selected_commander_id:
				commander_option.select(index)
				break
	outcome_label.visible = outcome.size() > 0
	if outcome.size() > 0:
		outcome_label.text = _outcome_text()
	var selected_unit_index: int = _unit_index(selected_unit_id)
	var selected_unit_name: String = friendly_units[selected_unit_index].get("name", "未选择") if selected_unit_index >= 0 else "未选择"
	var selected_target_name: String = _area_name(selected_target_area_id) if selected_target_area_id != "" else "未选择"
	selection_label.text = "当前部队：%s\n目标区域：%s\n接收军官：%s · %s" % [selected_unit_name, selected_target_name, _commander_name(selected_commander_id), _commander_location_text(selected_commander_id)]
	run_button.text = "暂停实时推演" if running else "开始实时推演"
	if replay_mode:
		run_button.text = "暂停回放" if running else "播放回放"
	run_button.disabled = outcome.size() > 0
	move_button.text = "机动"
	move_button.tooltip_text = "向%s机动" % selected_target_name if selected_target_area_id != "" else "请先在沙盘选择目标区域"
	move_button.disabled = replay_mode or outcome.size() > 0 or selected_target_area_id == "" or (not order.is_empty() and order.get("status", "") in ["transmitting", "executing"])
	hold_button.disabled = replay_mode or outcome.size() > 0 or selected_unit_id == "" or (not order.is_empty() and order.get("status", "") in ["transmitting", "executing"])
	if task_option != null:
		task_option.disabled = replay_mode or outcome.size() > 0 or selected_unit_id == "" or (not order.is_empty() and order.get("status", "") in ["transmitting", "executing"])
		task_option.tooltip_text = "先选部队和目标区域，再选择任务" if selected_target_area_id == "" else "选择警戒、掩护、封锁、诱敌、截粮或撤退"
	scout_button.disabled = replay_mode or outcome.size() > 0 or pending_count > 0 or preparation_count > 0 or not _can_afford(scenario.get("scout", {}).get("cost", {}))
	deception_button.text = "计策"
	deception_button.tooltip_text = str(deception_actions[0].get("name", "暂无可用计策")) if not deception_actions.is_empty() else "暂无可用计策"
	deception_button.disabled = replay_mode or outcome.size() > 0 or not engine_connected or deception_actions.is_empty()
	var gateway_busy: bool = false
	if engine_gateway != null:
		gateway_busy = engine_gateway.busy()
	free_order_input.editable = not replay_mode and outcome.size() == 0 and not gateway_busy
	free_order_button.disabled = replay_mode or outcome.size() > 0 or gateway_busy
	replay_button.disabled = replay_mode
	load_replay_button.disabled = replay_mode
	exit_replay_button.disabled = not replay_mode
	if new_battle_button != null:
		new_battle_button.disabled = replay_mode or (engine_gateway != null and engine_gateway.busy())
	if replay_panel != null:
		replay_panel.visible = replay_mode
	replay_slider.editable = replay_mode
	if replay_mode:
		replay_slider.max_value = replay_player.duration()
		replay_slider.set_block_signals(true)
		replay_slider.value = sim_time
		replay_slider.set_block_signals(false)
	log_label.text = "\n".join(log_lines)
	if zoom_label != null:
		zoom_label.text = "%d%%" % int(map_camera.zoom.x * 100.0)
	if speed_option != null:
		for index in range(speed_option.item_count):
			if int(speed_option.get_item_metadata(index)) == simulation_speed:
				speed_option.select(index)
				break
	if intelligence_button != null:
		intelligence_button.text = "情报 %d" % reported_signals.size()
	if battle_button != null:
		battle_button.text = "战局"
	if battle_panel != null and battle_panel.visible:
		_refresh_battle_panel()
	if intelligence_panel != null and intelligence_panel.visible:
		_refresh_intelligence_panel()
	if deception_panel != null and deception_panel.visible:
		_refresh_deception_panel()
	sand_table.set_selection(selected_unit_id, selected_target_area_id)
	_prune_map_notices()
	sand_table.set_commander_layers(friendly_units, reported_signals, order, pending_observations, sim_time, map_notices)

func _add_map_notice(kind: String, area_id: String, label: String, lifetime_seconds: int = 8) -> void:
	if area_id == "":
		return
	map_notices.append({
		"kind": kind,
		"areaId": area_id,
		"label": label,
		"expiresAt": sim_time + max(1, lifetime_seconds),
	})

func _prune_map_notices() -> void:
	for index in range(map_notices.size() - 1, -1, -1):
		if int(map_notices[index].get("expiresAt", sim_time)) < sim_time:
			map_notices.remove_at(index)

func _guide_text() -> String:
	if replay_mode:
		return "回放模式：拖动时间轴查看军令、行军与前线回报的先后关系"
	if outcome.size() > 0:
		return "战役已结束：打开“战局”查看复盘，或点击右侧“新局”重新开始"
	var order_status := str(order.get("status", "")) if not order.is_empty() else ""
	if order_status in ["transmitting", "executing"]:
		return "军令已下达：继续推进时间，观察传令、行军和副将回报"
	match order_status:
		"completed": return "军令已完成：选择部队和目标，继续下达下一道军令"
		"refused", "rejected": return "军令未执行：查看副将反馈，调整接收军官或重新下令"
		"expired", "cancelled": return "军令已失效：重新确认部队、目标和接收军官"
		"blocked": return "机动受阻：查看地形和前线反馈，调整路线或任务"
	if _pending_observation_count() > 0 or _preparing_strategy_count() > 0:
		return "前线正在回传：继续推进时间，等待可能失真的情报抵达"
	if selected_target_area_id != "":
		return "目标已选：点击“机动”快捷下令，或输入自由军令后点击“传达”"
	if selected_unit_id != "":
		return "已选秦军部队：点击沙盘上的区域选择目标"
	if not engine_connected:
		return "实时内核未接入：请先启动正式战场内核，再下达军令"
	return "第一步：从左侧选择一支秦军部队"

func _pending_observation_count() -> int:
	if engine_connected:
		return pending_observations.size()
	return 1 if not pending_scout.is_empty() else 0

func _preparing_strategy_count() -> int:
	if engine_connected:
		var count := 0
		for action in strategy_actions:
			if action.get("status", "") == "preparing":
				count += 1
		return count
	return 1 if pending_scout.get("status", "") == "preparing" else 0

func _resource_ledger() -> Dictionary:
	if resource_state.has("player") and resource_state.get("player") is Dictionary:
		return resource_state.get("player", {})
	return resource_state

func _resource_text(resource_key: String) -> String:
	var value := int(_resource_ledger().get(resource_key, -1))
	return "—" if value < 0 else str(value)

func _can_afford(cost: Variant) -> bool:
	if not cost is Dictionary:
		return true
	for key in cost.keys():
		if int(_resource_ledger().get(str(key), 0)) < int(cost[key]):
			return false
	return true

func _spend_resources(cost: Variant) -> void:
	if not cost is Dictionary:
		return
	var ledger := _resource_ledger()
	for key in cost.keys():
		ledger[str(key)] = max(0, int(ledger.get(str(key), 0)) - int(cost[key]))

func _order_status_text(status: String) -> String:
	match status:
		"transmitting": return "传令中"
		"executing": return "执行中"
		"completed": return "已完成"
		"refused": return "副将拒绝"
		"rejected": return "已驳回"
		"expired": return "已失效"
		"cancelled": return "已取消"
		"awaiting_report": return "等待前线报告"
		"blocked": return "被封锁"
		_: return status if status != "" else "暂无军令"

func _command_state_text() -> String:
	if order.is_empty():
		var pending_recipient := _commander_name(selected_commander_id)
		var pending_mode := "传令兵待命" if _command_delivery_mode() == "messenger" else "可当面传令"
		return "军令状态\n尚未下达军令\n交给%s · %s" % [pending_recipient, pending_mode]
	var order_type := str(order.get("taskLabel", "")) if order.get("taskType", "") != "" else ("坚守" if order.get("type", "move") == "hold" else "机动")
	var status := _order_status_text(str(order.get("status", "")))
	if int(order.get("executionResumeAt", -1)) > sim_time:
		status = "等待副将整备"
	var recipient_name := _commander_name(str(order.get("recipientCommanderId", selected_commander_id)))
	var communication_mode := str(order.get("communicationMode", _command_delivery_mode()))
	var chain_summary := "交给%s · %s" % [recipient_name, "传令兵在途" if communication_mode == "messenger" and status == "传令中" else ("当面传令" if communication_mode == "direct" else "常规链路")]
	var target := _area_name(str(order.get("targetAreaId", "")))
	if order.get("type", "move") == "hold":
		var hold_feedback := str(order.get("officerFeedback", ""))
		return "军令状态\n%s · %s\n%s%s" % [order_type, status, chain_summary, "\n" + hold_feedback if hold_feedback != "" else ""]
	var remaining := int(order.get("remainingTravelSeconds", 0))
	var progress := "目标：%s" % target if target != "未知区域" else "目标尚未确认"
	var current_terrain_value = order.get("currentTerrain", {})
	var current_terrain: Dictionary = current_terrain_value if current_terrain_value is Dictionary else {}
	if not current_terrain.is_empty():
		progress += " · %s中" % _terrain_action_word(str(current_terrain.get("terrainType", "")))
	else:
		var last_terrain_value = order.get("lastTerrainTransition", {})
		var last_terrain: Dictionary = last_terrain_value if last_terrain_value is Dictionary else {}
		if not last_terrain.is_empty():
			progress += " · 已%s" % _terrain_action_word(str(last_terrain.get("terrainType", "")))
	if status == "执行中" and remaining > 0:
		progress += " · 约%s" % _format_duration(remaining)
	var feedback := str(order.get("officerFeedback", ""))
	if feedback != "":
		progress += "\n" + feedback
	var execution_rate := float(order.get("executionRate", 1.0))
	if status == "执行中" and abs(execution_rate - 1.0) > 0.01:
		progress += " · 速度 %.2fx" % execution_rate
	return "军令状态\n%s · %s\n%s · %s" % [order_type, status, chain_summary, progress]

func _officer_decision_feedback(event: Dictionary) -> String:
	var payload_value = event.get("payload", {})
	var payload: Dictionary = payload_value if payload_value is Dictionary else event
	var officer_name := str(payload.get("officerName", "前线军官"))
	var decision := str(payload.get("decision", ""))
	var decision_label := "接受执行"
	match decision:
		"modified": decision_label = "调整执行"
		"delayed": decision_label = "延后执行"
		"refused": decision_label = "拒绝执行"
	return "%s%s：%s" % [officer_name, decision_label, str(payload.get("rationale", "已形成执行意见"))]

func _officer_route_feedback(event: Dictionary) -> String:
	var payload_value = event.get("payload", {})
	var payload: Dictionary = payload_value if payload_value is Dictionary else event
	var route_names := []
	for area_id in payload.get("selectedRoute", []):
		route_names.append(_area_name(str(area_id)))
	if route_names.is_empty():
		return "副将已调整行军路线"
	return "副将改道执行：%s" % " → ".join(route_names)

func _terrain_action_word(terrain_type: String) -> String:
	match terrain_type:
		"river": return "渡河"
		"mountain": return "翻山"
		_: return "通过"

func _outcome_text() -> String:
	var title := str(outcome.get("title", outcome.get("id", "战役结束")))
	var result := str(review.get("resultLabel", outcome.get("result", "unknown")))
	var reason := str(review.get("reasonLabel", outcome.get("reason", "unknown")))
	var stats: Dictionary = review.get("stats", {}) if review.get("stats", {}) is Dictionary else {}
	return "战后复盘\n%s\n%s · %s\n命令 %d · 情报 %d · 计策 %d" % [title, result, reason, int(stats.get("commandCount", 0)), int(stats.get("reportCount", 0)), int(stats.get("deceptionCount", 0))]
