extends Node2D

signal area_selected(area_id: String)
signal unit_selected(unit_id: String)

# The commander-facing sand table is a vector surface. Terrain is drawn from
# normalized scenario geometry so the simulation and the map share the same
# river crossings, ridgelines and movement semantics.
const MAP_RECT := Rect2(-20, -170, 1320, 1100)
const INK := Color("#33251e")
const MUTED_INK := Color("#6d5747")
const JADE := Color("#3d7162")
const CINNABAR := Color("#a5483e")
const GOLD := Color("#bb8e4a")
const WATER := Color("#6e8990")
const WATER_LIGHT := Color("#b9c2b4")
const MOUNTAIN := Color("#776a55")
const MOUNTAIN_LIGHT := Color("#c0aa7d")

var scenario: Dictionary = {}
var friendly_units: Array = []
var reported_signals: Array = []
var active_order: Dictionary = {}
var pending_scout: Dictionary = {}
var selected_unit_id := ""
var selected_area_id := ""

func configure(data: Dictionary) -> void:
	scenario = data
	queue_redraw()

func set_commander_layers(units: Array, reports: Array, commander_order: Dictionary = {}, scout: Dictionary = {}) -> void:
	# This node intentionally receives only the commander projection layers.
	# Enemy units and combat exchanges never enter the scene tree.
	friendly_units = units.duplicate(true)
	reported_signals = reports.duplicate(true)
	active_order = commander_order.duplicate(true)
	pending_scout = scout.duplicate(true)
	queue_redraw()

func set_selection(unit_id: String, area_id: String) -> void:
	selected_unit_id = unit_id
	selected_area_id = area_id
	queue_redraw()

func _unhandled_input(event: InputEvent) -> void:
	if not event is InputEventMouseButton:
		return
	if not event.pressed or event.button_index != MOUSE_BUTTON_LEFT:
		return
	var clicked_point := get_global_mouse_position()
	for unit in friendly_units:
		if clicked_point.distance_to(_unit_point(unit)) <= 32.0:
			unit_selected.emit(str(unit.get("id", "")))
			get_viewport().set_input_as_handled()
			return
	for area in scenario.get("areas", []):
		var area_id := str(area.get("id", ""))
		if clicked_point.distance_to(_area_point(area_id)) <= 34.0:
			area_selected.emit(area_id)
			get_viewport().set_input_as_handled()
			return

func _draw() -> void:
	draw_rect(MAP_RECT, Color("#e7d6b1"))
	_draw_vector_paper()
	_draw_terrain_features()
	draw_rect(MAP_RECT, Color("#76543d"), false, 3.0)
	draw_rect(MAP_RECT.grow(-10), Color(0.18, 0.12, 0.08, 0.15), false, 1.0)

	_draw_order_feedback()
	_draw_scout_feedback()

	for area in scenario.get("areas", []):
		var point := _area_point(area.get("id", ""))
		if point == Vector2.ZERO:
			continue
		draw_circle(point, 18.0, Color(0.93, 0.82, 0.59, 0.28))
		draw_arc(point, 18.0, 0.0, TAU, 32, Color(0.38, 0.27, 0.18, 0.7), 1.0)
		if area.get("id", "") == selected_area_id:
			draw_arc(point, 29.0, 0.0, TAU, 40, Color("#d8a95f"), 3.0)
			draw_circle(point, 25.0, Color(0.84, 0.63, 0.27, 0.08))
		draw_string(ThemeDB.fallback_font, point + Vector2(23, 4), area.get("name", ""), HORIZONTAL_ALIGNMENT_LEFT, -1, 15, INK)
		draw_string(ThemeDB.fallback_font, point + Vector2(23, 21), area.get("terrain", ""), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, MUTED_INK)

	for landmark in scenario.get("landmarks", []):
		var landmark_point := _area_point(landmark.get("areaId", ""))
		if landmark_point != Vector2.ZERO:
			var explicit_position: Dictionary = landmark.get("position", {})
			if explicit_position.has("x") and explicit_position.has("y"):
				landmark_point = MAP_RECT.position + Vector2(float(explicit_position.get("x", 0.0)) / 100.0 * MAP_RECT.size.x, float(explicit_position.get("y", 0.0)) / 100.0 * MAP_RECT.size.y)
			_draw_landmark(landmark_point, str(landmark.get("type", "")), str(landmark.get("label", "")))

	for unit in friendly_units:
		var unit_point := _unit_point(unit)
		if unit_point != Vector2.ZERO:
			_draw_flag(unit_point + Vector2(-2, -4), JADE, false, str(unit.get("id", "")) == selected_unit_id, "秦")

	for report in reported_signals:
		var report_point := _area_point(report.get("areaId", ""))
		if report_point != Vector2.ZERO:
			_draw_report_uncertainty(report, report_point)
			_draw_flag(report_point + Vector2(18, -2), CINNABAR, true, false, "赵?")

	draw_string(ThemeDB.fallback_font, MAP_RECT.position + Vector2(18, 34), "长平决战前 · 指挥官认知沙盘", HORIZONTAL_ALIGNMENT_LEFT, -1, 20, INK)
	draw_string(ThemeDB.fallback_font, MAP_RECT.position + Vector2(18, 57), "河流与山脊来自结构地形；敌情来自延迟前线报告", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, MUTED_INK)
	_draw_legend()

func _draw_vector_paper() -> void:
	# Keep the paper feeling without baking any geographic truth into an image.
	for y in range(0, 11):
		var line_y := MAP_RECT.position.y + 92.0 + float(y) * 92.0
		draw_line(Vector2(MAP_RECT.position.x + 10.0, line_y), Vector2(MAP_RECT.end.x - 10.0, line_y), Color(0.36, 0.29, 0.20, 0.045), 1.0)
	for x in range(0, 14):
		var line_x := MAP_RECT.position.x + 92.0 + float(x) * 92.0
		draw_line(Vector2(line_x, MAP_RECT.position.y + 10.0), Vector2(line_x, MAP_RECT.end.y - 10.0), Color(0.36, 0.29, 0.20, 0.035), 1.0)

func _terrain_point(raw_point: Dictionary) -> Vector2:
	return MAP_RECT.position + Vector2(
		float(raw_point.get("x", 0.0)) / 100.0 * MAP_RECT.size.x,
		float(raw_point.get("y", 0.0)) / 100.0 * MAP_RECT.size.y,
	)

func _draw_terrain_features() -> void:
	for feature in scenario.get("terrainFeatures", []):
		var points := PackedVector2Array()
		for raw_point in feature.get("points", []):
			if raw_point is Dictionary:
				points.append(_terrain_point(raw_point))
		if points.size() < 2:
			continue
		match str(feature.get("type", "")):
			"river": _draw_river_feature(points, str(feature.get("name", "河流")), float(feature.get("width", 3.0)))
			"mountain-range": _draw_mountain_feature(points, str(feature.get("name", "山脊")))

func _draw_river_feature(points: PackedVector2Array, label: String, width: float) -> void:
	# Wide pale bank + narrow blue current makes the water legible at a glance.
	draw_polyline(points, Color(WATER_LIGHT, 0.58), max(26.0, width * 13.0), true)
	draw_polyline(points, Color(WATER, 0.72), max(9.0, width * 4.0), true)
	for index in range(1, points.size() - 1):
		var point := points[index]
		draw_arc(point + Vector2(0, -2), 7.0, PI * 0.12, PI * 0.88, 12, Color(0.85, 0.88, 0.78, 0.58), 1.2)
		if index % 2 == 0:
			draw_arc(point + Vector2(16, 5), 6.0, PI * 0.12, PI * 0.88, 12, Color(0.85, 0.88, 0.78, 0.45), 1.0)
	var label_point := points[int(points.size() / 2)] + Vector2(14, -14)
	draw_string(ThemeDB.fallback_font, label_point, label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("#526d71"))

func _draw_mountain_feature(points: PackedVector2Array, label: String) -> void:
	draw_polyline(points, Color(MOUNTAIN_LIGHT, 0.26), 24.0, true)
	draw_polyline(points, Color(MOUNTAIN, 0.7), 2.0, true)
	for index in range(points.size() - 1):
		var point := points[index].lerp(points[index + 1], 0.5)
		var peak := point + Vector2(0, -24)
		var mountain := PackedVector2Array([point + Vector2(-22, 17), peak, point + Vector2(22, 17)])
		draw_colored_polygon(mountain, Color(MOUNTAIN_LIGHT, 0.2))
		draw_polyline(mountain, Color(MOUNTAIN, 0.58), 1.5)
	var label_point := points[0] + Vector2(10, -28)
	draw_string(ThemeDB.fallback_font, label_point, label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color("#6e5c49"))

func _area_point(area_id: String) -> Vector2:
	for area in scenario.get("areas", []):
		if area.get("id", "") != area_id:
			continue
		var position: Dictionary = area.get("position", {})
		return MAP_RECT.position + Vector2(float(position.get("x", 0.0)) / 100.0 * MAP_RECT.size.x, float(position.get("y", 0.0)) / 100.0 * MAP_RECT.size.y)
	return Vector2.ZERO

func _unit_point(unit: Dictionary) -> Vector2:
	var projected_position = unit.get("position", null)
	if projected_position is Dictionary and projected_position.has("x") and projected_position.has("y"):
		return _terrain_point(projected_position)
	return _area_point(str(unit.get("areaId", "")))

func _unit_index(unit_id: String) -> int:
	for index in range(friendly_units.size()):
		if str(friendly_units[index].get("id", "")) == unit_id:
			return index
	return -1

func _draw_landmark(point: Vector2, marker_type: String, label: String = "") -> void:
	var color := GOLD
	var fill := Color(color, 0.18)
	match marker_type:
		"city":
			draw_rect(Rect2(point - Vector2(12, 9), Vector2(24, 18)), fill)
			draw_rect(Rect2(point - Vector2(12, 9), Vector2(24, 18)), color, false, 2.0)
			for x in [-8.0, 0.0, 8.0]:
				draw_line(point + Vector2(x, -9), point + Vector2(x, -13), color, 2.0)
			draw_line(point + Vector2(-3, 9), point + Vector2(-3, 1), color, 2.0)
			draw_line(point + Vector2(3, 9), point + Vector2(3, 1), color, 2.0)
		"granary":
			draw_rect(Rect2(point - Vector2(9, 7), Vector2(18, 16)), fill)
			draw_rect(Rect2(point - Vector2(9, 7), Vector2(18, 16)), color, false, 2.0)
			draw_arc(point + Vector2(0, -7), 9.0, PI, TAU, 16, color, 2.0)
			draw_line(point + Vector2(-4, -3), point + Vector2(-4, 8), color, 1.5)
			draw_line(point + Vector2(4, -3), point + Vector2(4, 8), color, 1.5)
		"fortress":
			draw_rect(Rect2(point - Vector2(11, 9), Vector2(22, 18)), fill)
			draw_rect(Rect2(point - Vector2(11, 9), Vector2(22, 18)), color, false, 2.5)
			for x in [-8.0, 0.0, 8.0]:
				draw_line(point + Vector2(x, -9), point + Vector2(x, -14), color, 2.0)
			draw_line(point + Vector2(-5, 9), point + Vector2(5, 9), color, 2.0)
		"pass":
			draw_line(point + Vector2(-12, 9), point + Vector2(0, -12), color, 3.0)
			draw_line(point + Vector2(0, -12), point + Vector2(12, 9), color, 3.0)
			draw_line(point + Vector2(-8, 9), point + Vector2(8, 9), color, 2.0)
		"camp":
			var tent := PackedVector2Array([point + Vector2(-13, 8), point + Vector2(0, -11), point + Vector2(13, 8)])
			draw_colored_polygon(tent, fill)
			draw_polyline(tent, color, 2.0)
			draw_line(point + Vector2(0, -11), point + Vector2(0, 8), color, 2.0)
		"ford":
			draw_line(point + Vector2(-14, -5), point + Vector2(14, -5), color, 2.0)
			draw_line(point + Vector2(-14, 5), point + Vector2(14, 5), color, 2.0)
			for x in [-8.0, 0.0, 8.0]:
				draw_circle(point + Vector2(x, 0), 3.0, fill)
				draw_arc(point + Vector2(x, 0), 3.0, 0.0, TAU, 12, color, 1.5)
		"highland":
			var ridge := PackedVector2Array([point + Vector2(-14, 8), point + Vector2(-4, -8), point + Vector2(2, 0), point + Vector2(9, -12), point + Vector2(15, 8)])
			draw_colored_polygon(ridge, fill)
			draw_polyline(ridge, color, 2.0)
		"route":
			draw_circle(point, 10.0, fill)
			draw_arc(point, 10.0, 0.0, TAU, 20, color, 2.0)
			draw_line(point + Vector2(-6, 0), point + Vector2(6, 0), color, 2.0)
			draw_line(point + Vector2(2, -4), point + Vector2(6, 0), color, 2.0)
			draw_line(point + Vector2(2, 4), point + Vector2(6, 0), color, 2.0)
		_:
			draw_circle(point, 8.0, fill)
			draw_arc(point, 8.0, 0.0, TAU, 20, color, 2.0)
	if label != "":
		draw_string(ThemeDB.fallback_font, point + Vector2(17, 27), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 10, MUTED_INK)

func _draw_order_feedback() -> void:
	if active_order.is_empty():
		return
	var origin_id := str(active_order.get("originAreaId", ""))
	if origin_id == "":
		origin_id = str(active_order.get("areaId", ""))
	var target_id := str(active_order.get("targetAreaId", ""))
	if target_id == "":
		return
	if str(active_order.get("type", "move")) == "hold":
		_draw_status_pulse(_area_point(origin_id), Color("#76a48a"), "坚守中")
		return
	var points := _order_path_points(active_order, origin_id, target_id)
	if points.size() < 1:
		return
	var status := str(active_order.get("status", ""))
	var accent := Color("#d8a95f") if status == "transmitting" else Color("#76a48a")
	for index in range(points.size() - 1):
		if status == "transmitting":
			draw_dashed_line(points[index], points[index + 1], Color(accent, 0.9), 4.0, 10.0)
		else:
			draw_line(points[index], points[index + 1], Color(accent, 0.92), 4.0, true)
	var progress: float = 0.0
	if status == "executing":
		var total: int = max(1, int(active_order.get("totalTravelSeconds", 0)))
		var remaining: int = max(0, int(active_order.get("remainingTravelSeconds", total)))
		progress = clamp(1.0 - float(remaining) / float(total), 0.0, 1.0)
	elif status == "completed":
		progress = 1.0
	var marker_point := _point_along_path(points, progress)
	if status == "transmitting":
		_draw_status_pulse(points[0], accent, "传令中")
	else:
		var terrain_label := _movement_terrain_label(active_order)
		_draw_marching_marker(marker_point, accent, terrain_label if terrain_label != "" else "行军中")
	if status == "completed":
		_draw_status_pulse(points[points.size() - 1], Color("#b8d2a4"), "已抵达")
	elif status == "executing":
		var last_transition_value = active_order.get("lastTerrainTransition", {})
		var last_transition: Dictionary = last_transition_value if last_transition_value is Dictionary else {}
		if not last_transition.is_empty() and active_order.get("currentTerrain", null) == null:
			_draw_status_pulse(marker_point, Color("#b8d2a4"), "已%s" % _terrain_action_word(str(last_transition.get("terrainType", ""))))

func _movement_terrain_label(commander_order: Dictionary) -> String:
	var current_value = commander_order.get("currentTerrain", {})
	var current: Dictionary = current_value if current_value is Dictionary else {}
	if current.is_empty():
		return ""
	return "%s中" % _terrain_action_word(str(current.get("terrainType", "")))

func _terrain_action_word(terrain_type: String) -> String:
	match terrain_type:
		"river": return "渡河"
		"mountain": return "翻山"
		_: return "通过"

func _draw_scout_feedback() -> void:
	if pending_scout.is_empty():
		return
	var target_id := str(pending_scout.get("reportedAreaId", ""))
	var origin_id := ""
	var unit_index := _unit_index(selected_unit_id)
	if unit_index >= 0:
		origin_id = str(friendly_units[unit_index].get("areaId", ""))
	var origin := _area_point(origin_id)
	var target := _area_point(target_id)
	if origin == Vector2.ZERO or target == Vector2.ZERO:
		return
	_draw_report_uncertainty(pending_scout, target)
	draw_dashed_line(origin, target, Color(0.83, 0.66, 0.32, 0.62), 2.0, 6.0)
	_draw_status_pulse(target, Color("#d8a95f"), "侦察返回中")

func _draw_report_uncertainty(report: Dictionary, center: Vector2) -> void:
	var uncertainty_value = report.get("uncertainty", {})
	var uncertainty: Dictionary = uncertainty_value if uncertainty_value is Dictionary else {}
	var level := str(uncertainty.get("level", report.get("confidence", "unknown")))
	var radius_normalized: float = clamp(float(uncertainty.get("radiusNormalized", _report_radius_normalized(level))), 0.04, 0.22)
	var radius: float = max(18.0, radius_normalized * min(MAP_RECT.size.x, MAP_RECT.size.y) * 0.72)
	var color := Color("#b7c8a1") if level == "high" else Color("#d8a95f") if level == "medium" else Color("#b86756")
	draw_circle(center, radius, Color(color, 0.055))
	draw_arc(center, radius, 0.0, TAU, 48, Color(color, 0.48), 1.5)
	draw_arc(center, radius + 4.0, 0.2, 1.55, 18, Color(color, 0.28), 1.0)

func _report_radius_normalized(level: String) -> float:
	match level:
		"high": return 0.04
		"medium": return 0.09
		"low": return 0.16
		_: return 0.2

func _order_path_points(commander_order: Dictionary, origin_id: String, target_id: String) -> PackedVector2Array:
	var points := PackedVector2Array()
	for area_id in commander_order.get("route", []):
		var point := _area_point(str(area_id))
		if point != Vector2.ZERO:
			points.append(point)
	if points.is_empty():
		var origin := _area_point(origin_id)
		var target := _area_point(target_id)
		if origin != Vector2.ZERO:
			points.append(origin)
		if target != Vector2.ZERO and target != origin:
			points.append(target)
	return points

func _point_along_path(points: PackedVector2Array, progress: float) -> Vector2:
	if points.is_empty():
		return Vector2.ZERO
	if points.size() == 1:
		return points[0]
	var total_length := 0.0
	for index in range(points.size() - 1):
		total_length += points[index].distance_to(points[index + 1])
	var remaining_length: float = total_length * clamp(progress, 0.0, 1.0)
	for index in range(points.size() - 1):
		var segment_length := points[index].distance_to(points[index + 1])
		if remaining_length <= segment_length:
			return points[index].lerp(points[index + 1], remaining_length / max(0.001, segment_length))
		remaining_length -= segment_length
	return points[points.size() - 1]

func _draw_status_pulse(point: Vector2, color: Color, label: String) -> void:
	draw_circle(point, 22.0, Color(color, 0.12))
	draw_arc(point, 22.0, 0.0, TAU, 32, Color(color, 0.85), 2.0)
	draw_string(ThemeDB.fallback_font, point + Vector2(25, -8), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, color)

func _draw_marching_marker(point: Vector2, color: Color, label: String) -> void:
	draw_circle(point, 9.0, Color("#f5e2b3"))
	draw_circle(point, 6.0, color)
	draw_arc(point, 14.0, 0.0, TAU, 24, Color(color, 0.95), 2.0)
	draw_string(ThemeDB.fallback_font, point + Vector2(18, 4), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, color)

func _draw_flag(point: Vector2, color: Color, uncertain: bool, selected: bool = false, label: String = "") -> void:
	if selected:
		draw_circle(point + Vector2(10, -14), 31.0, Color(0.86, 0.67, 0.32, 0.12))
		draw_arc(point + Vector2(10, -14), 31.0, 0.0, TAU, 36, Color("#d8a95f"), 2.0)
	if uncertain:
		draw_circle(point + Vector2(12, -15), 30.0, Color(0.65, 0.28, 0.22, 0.08))
		draw_arc(point + Vector2(12, -15), 30.0, 0.0, TAU, 32, Color(0.72, 0.35, 0.26, 0.55), 1.5)
	draw_line(point, point + Vector2(0, -25), color, 2.0)
	var flag := PackedVector2Array([point + Vector2(0, -25), point + Vector2(25, -19), point + Vector2(0, -10)])
	draw_colored_polygon(flag, Color(color, 0.9))
	if label != "":
		draw_string(ThemeDB.fallback_font, point + Vector2(3, -17), label, HORIZONTAL_ALIGNMENT_CENTER, 18, 9, Color("#f7e9c4"))
	if uncertain:
		draw_circle(point + Vector2(12, -30), 9.0, Color("#f3dfb2"))
		draw_string(ThemeDB.fallback_font, point + Vector2(8, -25), "?", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, CINNABAR)

func _draw_legend() -> void:
	var origin := MAP_RECT.position + Vector2(18, 78)
	draw_rect(Rect2(origin - Vector2(7, 7), Vector2(408, 60)), Color(0.94, 0.86, 0.67, 0.86))
	draw_rect(Rect2(origin - Vector2(7, 7), Vector2(408, 60)), Color("#8b6840"), false, 1.0)
	draw_string(ThemeDB.fallback_font, origin, "战场双方", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, INK)
	draw_circle(origin + Vector2(67, -4), 5.0, JADE)
	draw_string(ThemeDB.fallback_font, origin + Vector2(77, 0), "秦军·已知位置", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, INK)
	draw_circle(origin + Vector2(179, -4), 5.0, CINNABAR)
	draw_string(ThemeDB.fallback_font, origin + Vector2(189, 0), "赵军·疑似情报", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, INK)
	draw_circle(origin + Vector2(67, 17), 5.0, GOLD)
	draw_string(ThemeDB.fallback_font, origin + Vector2(77, 21), "地标·中立信息", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, INK)
	draw_line(origin + Vector2(198, 17), origin + Vector2(220, 17), WATER, 4.0)
	draw_string(ThemeDB.fallback_font, origin + Vector2(228, 21), "水系·渡河段", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, INK)
	draw_line(origin + Vector2(300, 17), origin + Vector2(322, 17), MOUNTAIN, 2.0)
	draw_string(ThemeDB.fallback_font, origin + Vector2(330, 21), "山脊·翻山段", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, INK)
