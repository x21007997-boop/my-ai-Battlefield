extends Node

class_name BattlefieldEngineGateway

signal response_received(operation: String, response: Dictionary)
signal request_failed(operation: String, message: String)

var base_url := ""
var session_id := ""
var event_cursor := 0
var request_in_flight := false
var request_operation := ""
var http_request: HTTPRequest

func _ready() -> void:
	http_request = HTTPRequest.new()
	http_request.timeout = 5.0
	http_request.request_completed.connect(_on_request_completed)
	add_child(http_request)

func configure(url: String) -> void:
	base_url = url.trim_suffix("/")

func busy() -> bool:
	return request_in_flight

func start_session() -> void:
	_post("/sessions", {}, "start_session")

func send_command(command: Dictionary) -> void:
	if session_id == "":
		emit_signal("request_failed", "command", "尚未建立内核会话。")
		return
	_post("/sessions/%s/commands" % session_id, {
		"eventCursor": event_cursor,
		"command": command,
	}, "command")

func _post(path: String, body: Dictionary, operation: String) -> void:
	if request_in_flight:
		return
	if base_url == "":
		emit_signal("request_failed", operation, "内核网关地址为空。")
		return
	request_operation = operation
	request_in_flight = true
	var error := http_request.request(
		base_url + path,
		PackedStringArray(["Content-Type: application/json"]),
		HTTPClient.METHOD_POST,
		JSON.stringify(body),
	)
	if error != OK:
		request_in_flight = false
		emit_signal("request_failed", operation, "无法发起内核请求：%s" % error)

func _on_request_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	var operation := request_operation
	request_in_flight = false
	request_operation = ""
	if result != HTTPRequest.RESULT_SUCCESS:
		emit_signal("request_failed", operation, "内核网关连接失败：%s" % result)
		return
	var parsed = JSON.parse_string(body.get_string_from_utf8())
	if not parsed is Dictionary:
		emit_signal("request_failed", operation, "内核返回不是有效 JSON。")
		return
	if response_code < 200 or response_code >= 300:
		emit_signal("request_failed", operation, str(parsed.get("error", "内核请求失败。")))
		return
	if parsed.has("sessionId"):
		session_id = str(parsed.get("sessionId", session_id))
	event_cursor = int(parsed.get("nextEventCursor", event_cursor))
	emit_signal("response_received", operation, parsed)
