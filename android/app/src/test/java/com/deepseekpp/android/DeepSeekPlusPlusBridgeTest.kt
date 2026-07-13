package com.deepseekpp.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeepSeekPlusPlusBridgeTest {
    @Test
    fun storageBatchesAreAllowlistedAtomicAndExplicitOnCorruption() {
        val store = FakePreferenceStore()
        val bridge = bridge(store)

        assertTrue(response(bridge.dispatch(request(
            "storage.set",
            JSONObject().put("values", JSONObject()
                .put("deepseek_pp_locale_preference", "zh-CN")
                .put("deepseek_pp_history_organizer", JSONObject().put("enabled", true))),
        ))).getBoolean("ok"))
        assertEquals("\"zh-CN\"", store.values["deepseek_pp_locale_preference"])

        val rejected = response(bridge.dispatch(request(
            "storage.set",
            JSONObject().put("values", JSONObject()
                .put("deepseek_pp_locale_preference", "en-US")
                .put("dpp_inline_agent_traces", JSONArray())),
        )))
        assertFalse(rejected.getBoolean("ok"))
        assertEquals("android_storage_key_not_allowed", rejected.getJSONObject("error").getString("code"))
        assertEquals("\"zh-CN\"", store.values["deepseek_pp_locale_preference"])

        store.values["deepseek_pp_history_organizer"] = "not-json"
        val corrupted = response(bridge.dispatch(request(
            "storage.get",
            JSONObject().put("keys", JSONArray().put("deepseek_pp_history_organizer")),
        )))
        assertFalse(corrupted.getBoolean("ok"))
        assertEquals("android_storage_value_invalid", corrupted.getJSONObject("error").getString("code"))
        assertEquals("not-json", store.values["deepseek_pp_history_organizer"])
    }

    @Test
    fun emptyDescriptorAuthorizationSupportsIdempotentClose() {
        val bridge = bridge(FakePreferenceStore())
        val createResult = runtimeResult(bridge, JSONObject()
            .put("type", "CREATE_TOOL_AUTHORIZATION")
            .put("payload", JSONObject()
                .put("requestId", "request:1")
                .put("trigger", "manual_chat")
                .put("chatSessionId", JSONObject.NULL)))
        assertEquals("android-auth:1", createResult.getString("id"))
        assertEquals(0, createResult.getJSONArray("descriptors").length())
        assertEquals(1_800_100L, createResult.getLong("expiresAt"))

        val closeMessage = JSONObject()
            .put("type", "CLOSE_TOOL_AUTHORIZATION")
            .put("payload", JSONObject().put("authorizationId", "android-auth:1"))
        assertTrue(runtimeResult(bridge, closeMessage).getBoolean("ok"))
        assertTrue(runtimeResult(bridge, closeMessage).getBoolean("ok"))
    }

    @Test
    fun privilegedRuntimeMessagesRemainUnsupported() {
        val result = runtimeResult(
            bridge(FakePreferenceStore()),
            JSONObject().put("type", "EXECUTE_TOOL_CALL"),
        )
        assertFalse(result.getBoolean("ok"))
        assertEquals("android_background_message_unsupported", result.getString("error"))
        assertEquals("EXECUTE_TOOL_CALL", result.getString("type"))
    }

    private fun bridge(store: FakePreferenceStore) = DeepSeekPlusPlusBridge(
        store,
        { 100L },
        { "android-auth:1" },
    )

    private fun runtimeResult(bridge: DeepSeekPlusPlusBridge, message: JSONObject): JSONObject =
        response(bridge.dispatch(request(
            "runtime.sendMessage",
            JSONObject().put("message", message),
        ))).getJSONObject("result")

    private fun request(command: String, payload: JSONObject): String = JSONObject()
        .put("protocol", AndroidBridgeContract.PROTOCOL)
        .put("version", AndroidBridgeContract.VERSION)
        .put("id", "android:1")
        .put("command", command)
        .put("payload", payload)
        .toString()

    private fun response(value: String) = JSONObject(value)

    private class FakePreferenceStore : AndroidPreferenceStore {
        val values = mutableMapOf<String, String>()

        override fun read(key: String): String? = values[key]

        override fun write(values: Map<String, String>): Boolean {
            this.values.putAll(values)
            return true
        }

        override fun remove(keys: Collection<String>): Boolean {
            keys.forEach(values::remove)
            return true
        }
    }
}
