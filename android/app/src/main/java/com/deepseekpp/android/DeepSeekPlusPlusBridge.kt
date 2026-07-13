package com.deepseekpp.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class DeepSeekPlusPlusBridge internal constructor(
    private val preferences: AndroidPreferenceStore,
    private val clock: () -> Long,
    private val createAuthorizationId: () -> String,
) {
    private val activeAuthorizationExpiries = mutableMapOf<String, Long>()

    constructor(context: Context) : this(
        SharedPreferencesAndroidPreferenceStore(context),
        System::currentTimeMillis,
        { "android-${UUID.randomUUID()}" },
    )

    fun dispatch(requestJson: String): String {
        val request = try {
            AndroidBridgeRequestCodec.decode(requestJson)
        } catch (error: AndroidBridgeDecodeException) {
            return failure(error.requestId, error.code)
        }
        val id = request.id
        val payload = request.payload

        return try {
            when (request.command) {
                "runtime.sendMessage" -> success(id, handleRuntimeMessage(payload))
                "storage.get" -> handleStorageGet(id, payload)
                "storage.set" -> handleStorageSet(id, payload)
                "storage.remove" -> handleStorageRemove(id, payload)
                else -> failure(id, "android_bridge_command_unsupported")
            }
        } catch (_: Exception) {
            failure(id, "android_bridge_invalid_payload")
        }
    }

    fun reject(requestJson: String, code: String): String =
        failure(AndroidBridgeRequestCodec.requestIdOrEmpty(requestJson), code)

    private fun handleRuntimeMessage(payload: JSONObject): Any {
        if (!hasExactKeys(payload, setOf("message"))) return runtimeFailure("android_runtime_invalid_message")
        val message = payload.optJSONObject("message")
            ?: return runtimeFailure("android_runtime_invalid_message")
        val type = message.opt("type") as? String
            ?: return runtimeFailure("android_runtime_invalid_message")
        if (!AndroidBridgeContract.isSupportedRuntimeMessage(type)) {
            return runtimeUnsupported(type)
        }
        if (type in NO_PAYLOAD_RUNTIME_TYPES && !hasExactKeys(message, setOf("type"))) {
            return runtimeFailure("android_runtime_invalid_message")
        }
        if (type == "GET_PROJECT_CONTEXT_FOR_CONVERSATION" && !isValidProjectContextRequest(message)) {
            return runtimeFailure("android_runtime_invalid_message")
        }

        return when (type) {
            "GET_MEMORIES",
            "GET_SKILLS",
            "GET_TOOL_DESCRIPTORS",
            "GET_MCP_SERVERS" -> JSONArray()
            "GET_ACTIVE_PRESET",
            "GET_MODEL_TYPE",
            "GET_PROJECT_CONTEXT_FOR_CONVERSATION",
            "GET_BACKGROUND" -> JSONObject.NULL
            "GET_PROMPT_INJECTION_SETTINGS" -> JSONObject()
                .put("memoryEnabled", true)
                .put("systemPromptEnabled", true)
                .put("presetCadence", "default")
                .put("forceResponseLanguage", "auto")
            "CREATE_TOOL_AUTHORIZATION" -> createToolAuthorization(message)
            "CLOSE_TOOL_AUTHORIZATION" -> closeToolAuthorization(message)
            "GET_PLATFORM_CAPABILITIES" -> platformEnvironment()
            "GET_PET" -> JSONObject()
                .put("enabled", false)
                .put("position", "bottom-right")
                .put("size", 72)
                .put("opacity", 1)
                .put("motion", true)
            "GET_DEEPSEEK_THEME" -> readTheme()
            "SET_DEEPSEEK_THEME" -> setTheme(message)
            "TOUCH_MEMORIES" -> touchMemories(message)
            else -> runtimeUnsupported(type)
        }
    }

    private fun createToolAuthorization(message: JSONObject): JSONObject {
        if (!hasOnlyKeys(message, setOf("type", "payload"))) {
            return runtimeFailure("invalid_tool_authorization_request")
        }
        val payload = message.optJSONObject("payload")
            ?: return runtimeFailure("invalid_tool_authorization_request")
        if (!hasOnlyKeys(payload, setOf("requestId", "trigger", "chatSessionId", "runId", "descriptorIds"))) {
            return runtimeFailure("invalid_tool_authorization_request")
        }

        val requestId = payload.opt("requestId") as? String
            ?: return runtimeFailure("invalid_tool_authorization_request")
        val trigger = payload.opt("trigger") as? String
            ?: return runtimeFailure("invalid_tool_authorization_request")
        val chatSessionId = payload.opt("chatSessionId")
        val runId = payload.opt("runId")
        val descriptorValue = payload.opt("descriptorIds")
        val descriptorIds = descriptorValue as? JSONArray
        if (!AndroidBridgeRequestCodec.isValidIdentity(requestId) ||
            (trigger != "manual_chat" && trigger != "agent_run") ||
            (chatSessionId != null && chatSessionId !== JSONObject.NULL && chatSessionId !is String) ||
            (payload.has("runId") && runId !is String) ||
            (payload.has("descriptorIds") && descriptorIds == null) ||
            (descriptorIds != null && descriptorIds.length() > 0)
        ) {
            return runtimeFailure(
                if (descriptorIds != null && descriptorIds.length() > 0) {
                    "unknown_tool_authorization_descriptor"
                } else {
                    "invalid_tool_authorization_request"
                },
            )
        }

        val now = clock()
        activeAuthorizationExpiries.entries.removeAll { (_, expiresAt) -> expiresAt <= now }
        if (activeAuthorizationExpiries.size >= MAX_ACTIVE_AUTHORIZATIONS) {
            return runtimeFailure("tool_authorization_grant_limit")
        }
        val authorizationId = createAuthorizationId()
        val expiresAt = now + AUTHORIZATION_TTL_MS
        activeAuthorizationExpiries[authorizationId] = expiresAt
        return JSONObject()
            .put("id", authorizationId)
            .put("requestId", requestId)
            .put("trigger", trigger)
            .put("chatSessionId", chatSessionId ?: JSONObject.NULL)
            .put("descriptors", JSONArray())
            .put("expiresAt", expiresAt)
    }

    private fun closeToolAuthorization(message: JSONObject): JSONObject {
        if (!hasOnlyKeys(message, setOf("type", "payload"))) {
            return runtimeFailure("invalid_tool_authorization_id")
        }
        val payload = message.optJSONObject("payload")
            ?: return runtimeFailure("invalid_tool_authorization_id")
        if (!hasOnlyKeys(payload, setOf("authorizationId"))) {
            return runtimeFailure("invalid_tool_authorization_id")
        }
        val authorizationId = payload.opt("authorizationId") as? String
            ?: return runtimeFailure("invalid_tool_authorization_id")
        if (!AndroidBridgeRequestCodec.isValidIdentity(authorizationId)) {
            return runtimeFailure("invalid_tool_authorization_id")
        }
        activeAuthorizationExpiries.remove(authorizationId)
        return ok()
    }

    private fun setTheme(message: JSONObject): JSONObject {
        if (!hasOnlyKeys(message, setOf("type", "payload"))) return runtimeFailure("invalid_theme")
        val payload = message.optJSONObject("payload") ?: return runtimeFailure("invalid_theme")
        if (!hasOnlyKeys(payload, setOf("theme"))) return runtimeFailure("invalid_theme")
        val theme = payload.opt("theme") as? String ?: return runtimeFailure("invalid_theme")
        if (theme != "light" && theme != "dark") return runtimeFailure("invalid_theme")
        val saved = preferences.write(mapOf(AndroidBridgeContract.THEME_STORAGE_KEY to JSONObject.quote(theme)))
        return if (saved) ok() else runtimeFailure("android_storage_write_failed")
    }

    private fun touchMemories(message: JSONObject): JSONObject {
        if (!hasOnlyKeys(message, setOf("type", "payload"))) return runtimeFailure("invalid_memory_ids")
        val payload = message.optJSONObject("payload") ?: return runtimeFailure("invalid_memory_ids")
        if (!hasOnlyKeys(payload, setOf("ids"))) return runtimeFailure("invalid_memory_ids")
        val ids = payload.optJSONArray("ids") ?: return runtimeFailure("invalid_memory_ids")
        for (index in 0 until ids.length()) {
            val id = when (val value = ids.opt(index)) {
                is Int -> value.toLong()
                is Long -> value
                else -> return runtimeFailure("invalid_memory_ids")
            }
            if (id < 0) return runtimeFailure("invalid_memory_ids")
        }
        return ok()
    }

    private fun isValidProjectContextRequest(message: JSONObject): Boolean {
        if (!hasExactKeys(message, setOf("type", "payload"))) return false
        val payload = message.optJSONObject("payload") ?: return false
        if (!hasOnlyKeys(payload, setOf("conversation", "bindPendingProject"))) return false
        val bindPendingProject = payload.opt("bindPendingProject")
        if (payload.has("bindPendingProject") && bindPendingProject !is Boolean) {
            return false
        }
        val conversation = payload.optJSONObject("conversation") ?: return false
        if (!hasOnlyKeys(conversation, setOf("conversationId", "title", "url"))) return false
        val conversationId = conversation.opt("conversationId") as? String ?: return false
        return AndroidBridgeRequestCodec.isValidIdentity(conversationId) &&
            isOptionalStringProperty(conversation, "title") &&
            isOptionalStringProperty(conversation, "url")
    }

    private fun handleStorageGet(id: String, payload: JSONObject): String {
        if (!hasExactKeys(payload, setOf("keys"))) return failure(id, "android_bridge_invalid_payload")
        val keys = try {
            readStorageKeys(payload.optJSONArray("keys"))
        } catch (_: Exception) {
            return failure(id, "android_storage_key_not_allowed")
        }
        val values = JSONObject()
        var totalChars = 0
        for (key in keys) {
            val raw = preferences.read(key) ?: continue
            if (raw.length > AndroidBridgeContract.MAX_STORAGE_VALUE_CHARS) {
                return failure(id, "android_storage_value_too_large")
            }
            totalChars += raw.length
            if (totalChars > AndroidBridgeContract.MAX_REQUEST_CHARS) {
                return failure(id, "android_storage_value_too_large")
            }
            val parsed = parseStoredJson(raw)
                ?: return failure(id, "android_storage_value_invalid")
            values.put(key, parsed)
        }
        return success(id, JSONObject().put("values", values))
    }

    private fun handleStorageSet(id: String, payload: JSONObject): String {
        if (!hasExactKeys(payload, setOf("values"))) return failure(id, "android_bridge_invalid_payload")
        val values = payload.optJSONObject("values")
            ?: return failure(id, "android_bridge_invalid_payload")
        val keys = values.keys().asSequence().toList()
        if (keys.size > AndroidBridgeContract.MAX_STORAGE_KEYS_PER_REQUEST ||
            keys.any { !AndroidBridgeContract.isAllowedStorageKey(it) }
        ) {
            return failure(id, "android_storage_key_not_allowed")
        }

        val serialized = keys.associateWith { key -> serializeJsonValue(values.opt(key)) }
        if (serialized.values.any { it.length > AndroidBridgeContract.MAX_STORAGE_VALUE_CHARS }) {
            return failure(id, "android_storage_value_too_large")
        }
        return if (preferences.write(serialized)) success(id, ok()) else failure(id, "android_storage_write_failed")
    }

    private fun handleStorageRemove(id: String, payload: JSONObject): String {
        if (!hasExactKeys(payload, setOf("keys"))) return failure(id, "android_bridge_invalid_payload")
        val keys = try {
            readStorageKeys(payload.optJSONArray("keys"))
        } catch (_: Exception) {
            return failure(id, "android_storage_key_not_allowed")
        }
        return if (preferences.remove(keys)) success(id, ok()) else failure(id, "android_storage_write_failed")
    }

    private fun readStorageKeys(value: JSONArray?): List<String> {
        val keys = value ?: throw IllegalArgumentException("missing keys")
        if (keys.length() > AndroidBridgeContract.MAX_STORAGE_KEYS_PER_REQUEST) {
            throw IllegalArgumentException("too many keys")
        }
        val result = ArrayList<String>(keys.length())
        for (index in 0 until keys.length()) {
            val key = keys.opt(index) as? String
                ?: throw IllegalArgumentException("key must be a string")
            if (!AndroidBridgeContract.isAllowedStorageKey(key)) {
                throw IllegalArgumentException("key not allowed")
            }
            result.add(key)
        }
        return result.distinct()
    }

    private fun platformEnvironment(): JSONObject {
        val capabilities = JSONObject()
            .put("storage", true)
            .put("runtimeMessaging", true)
            .put("downloads", false)
            .put("filePicker", true)
            .put("folderPicker", false)
            .put("assetUrl", true)
            .put("sidePanel", false)
            .put("nativeMessaging", false)
            .put("contextMenus", false)
            .put("alarms", false)
            .put("tabs", false)
            .put("tabGroups", false)
            .put("debugger", false)
            .put("browserControl", false)
            .put("accessibilityTree", false)
        return JSONObject()
            .put("kind", "android_webview")
            .put("name", "Android WebView")
            .put("capabilities", capabilities)
    }

    private fun readTheme(): String {
        val raw = preferences.read(AndroidBridgeContract.THEME_STORAGE_KEY) ?: return "light"
        val parsed = parseStoredJson(raw) as? String ?: return "light"
        return if (parsed == "dark" || parsed == "light") parsed else "light"
    }

    private fun serializeJsonValue(value: Any?): String {
        val wrapped = JSONArray().put(value).toString()
        return wrapped.substring(1, wrapped.length - 1)
    }

    private fun parseStoredJson(raw: String): Any? = try {
        StrictJson.requireValue(raw)
        JSONObject("{\"value\":$raw}").get("value")
    } catch (_: Exception) {
        null
    }

    private fun success(id: String, result: Any): String = response(id, true)
        .put("result", result)
        .toString()

    private fun failure(id: String, code: String): String = response(id, false)
        .put("error", JSONObject().put("code", code))
        .toString()

    private fun response(id: String, ok: Boolean): JSONObject = JSONObject()
        .put("protocol", AndroidBridgeContract.PROTOCOL)
        .put("version", AndroidBridgeContract.VERSION)
        .put("id", id)
        .put("ok", ok)

    private fun runtimeUnsupported(type: String): JSONObject = JSONObject()
        .put("ok", false)
        .put("error", "android_background_message_unsupported")
        .put("type", type)

    private fun runtimeFailure(code: String): JSONObject = JSONObject()
        .put("ok", false)
        .put("error", code)

    private fun ok(): JSONObject = JSONObject().put("ok", true)

    private fun isOptionalStringProperty(value: JSONObject, key: String): Boolean =
        !value.has(key) || value.opt(key) is String

    private fun hasOnlyKeys(value: JSONObject, allowed: Set<String>): Boolean =
        value.keys().asSequence().all { it in allowed }

    private fun hasExactKeys(value: JSONObject, expected: Set<String>): Boolean =
        value.keys().asSequence().toSet() == expected

    companion object {
        private const val AUTHORIZATION_TTL_MS = 30 * 60 * 1000L
        private const val MAX_ACTIVE_AUTHORIZATIONS = 32
        private val NO_PAYLOAD_RUNTIME_TYPES = setOf(
            "GET_MEMORIES",
            "GET_SKILLS",
            "GET_ACTIVE_PRESET",
            "GET_MODEL_TYPE",
            "GET_TOOL_DESCRIPTORS",
            "GET_PROMPT_INJECTION_SETTINGS",
            "GET_MCP_SERVERS",
            "GET_BACKGROUND",
            "GET_PET",
            "GET_PLATFORM_CAPABILITIES",
            "GET_DEEPSEEK_THEME",
        )
    }
}
