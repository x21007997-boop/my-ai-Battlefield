extends SceneTree

const Gateway = preload("res://scripts/engine_gateway.gd")

var gateway: BattlefieldEngineGateway
var stage := "start"
var finished := false

func _init() -> void:
	gateway = Gateway.new()
	get_root().add_child(gateway)
	gateway.configure("http://127.0.0.1:4317")
	gateway.response_received.connect(_on_response)
	gateway.request_failed.connect(_on_failed)
	call_deferred("_start_gateway")
	call_deferred("_timeout_guard")

func _start_gateway() -> void:
	gateway.start_session()

func _on_response(operation: String, response: Dictionary) -> void:
	if operation == "start_session":
		assert(response.get("sessionId", "") != "")
		assert(response.get("session", {}).get("disclosure", {}).get("rawEnemyUnitsIncluded", true) == false)
		stage = "move"
		gateway.send_command({"type": "move", "unitId": "qin-main", "targetAreaId": "dan-river-valley"})
		return
	if operation == "command" and stage == "move":
		assert(response.get("accepted", false) == true)
		assert(response.get("events", [])[0].get("payload", {}).get("actualAreaId", null) == null)
		stage = "advance"
		gateway.send_command({"type": "advance", "seconds": 4})
		return
	if operation == "command" and stage == "advance":
		assert(response.get("accepted", false) == true)
		assert(response.get("session", {}).get("simTime", 0) == 4)
		finished = true
		print("Godot engine gateway smoke test passed")
		quit()

func _on_failed(_operation: String, message: String) -> void:
	push_error(message)
	quit(1)

func _timeout_guard() -> void:
	await create_timer(5.0).timeout
	if not finished:
		push_error("Godot engine gateway smoke test timed out")
		quit(1)
