package com.deepseekpp.android

import org.json.JSONObject

data class AndroidBridgeRequest(
    val id: String,
    val command: String,
    val payload: JSONObject,
)

class AndroidBridgeDecodeException(
    val requestId: String,
    val code: String,
) : Exception(code)

object AndroidBridgeRequestCodec {
    fun decode(requestJson: String): AndroidBridgeRequest {
        if (requestJson.length > AndroidBridgeContract.MAX_REQUEST_CHARS) {
            throw AndroidBridgeDecodeException("", "android_bridge_request_too_large")
        }
        val request = try {
            StrictJson.requireObject(requestJson)
            JSONObject(requestJson)
        } catch (_: Exception) {
            throw AndroidBridgeDecodeException("", "android_bridge_invalid_request")
        }
        val id = request.opt("id") as? String ?: ""
        if (request.keys().asSequence().toSet() != REQUEST_KEYS ||
            request.opt("protocol") !is String ||
            request.opt("protocol") != AndroidBridgeContract.PROTOCOL ||
            request.opt("version") !is Int ||
            request.opt("version") != AndroidBridgeContract.VERSION ||
            !isValidIdentity(id)
        ) {
            throw AndroidBridgeDecodeException(id, "android_bridge_invalid_request")
        }

        val command = request.opt("command") as? String
            ?: throw AndroidBridgeDecodeException(id, "android_bridge_invalid_request")
        if (!AndroidBridgeContract.isSupportedCommand(command)) {
            throw AndroidBridgeDecodeException(id, "android_bridge_command_unsupported")
        }
        val payload = request.opt("payload") as? JSONObject
            ?: throw AndroidBridgeDecodeException(id, "android_bridge_invalid_payload")
        return AndroidBridgeRequest(id, command, payload)
    }

    fun isValidIdentity(value: String): Boolean =
        value.isNotBlank() && value.length <= MAX_IDENTITY_LENGTH && value.all {
            it.isLetterOrDigit() || it == '-' || it == '_' || it == '.' || it == ':'
        }

    fun requestIdOrEmpty(requestJson: String): String = try {
        StrictJson.requireObject(requestJson)
        val id = JSONObject(requestJson).opt("id") as? String ?: ""
        if (isValidIdentity(id)) id else ""
    } catch (_: Exception) {
        ""
    }

    private const val MAX_IDENTITY_LENGTH = 160
    private val REQUEST_KEYS = setOf("protocol", "version", "id", "command", "payload")
}
