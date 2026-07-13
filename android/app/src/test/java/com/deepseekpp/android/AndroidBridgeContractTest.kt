package com.deepseekpp.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidBridgeContractTest {
    @Test
    fun exposesOnlyStructuredNativeCommands() {
        assertTrue(AndroidBridgeContract.isSupportedCommand("runtime.sendMessage"))
        assertTrue(AndroidBridgeContract.isSupportedCommand("storage.get"))
        assertFalse(AndroidBridgeContract.isSupportedCommand("downloadBlob"))
        assertFalse(AndroidBridgeContract.isSupportedCommand("getStorage"))
        assertFalse(AndroidBridgeContract.isSupportedCommand("native.execute"))
    }

    @Test
    fun storageAllowlistExcludesCredentialsAndUnknownKeys() {
        assertTrue(AndroidBridgeContract.isAllowedStorageKey("deepseek_pp_locale_preference"))
        assertTrue(AndroidBridgeContract.isAllowedStorageKey("deepseek_pp_history_organizer"))
        assertFalse(AndroidBridgeContract.isAllowedStorageKey("deepseekCachedClientHeaders"))
        assertFalse(AndroidBridgeContract.isAllowedStorageKey("dpp_tool_execution_blocks"))
        assertFalse(AndroidBridgeContract.isAllowedStorageKey("dpp_inline_agent_traces"))
        assertFalse(AndroidBridgeContract.isAllowedStorageKey("deepseek_pp_mcp_servers"))
        assertFalse(AndroidBridgeContract.isAllowedStorageKey("future_key"))
    }

    @Test
    fun runtimeSubsetKeepsChatBootstrapButRejectsPrivilegedExecution() {
        assertTrue(AndroidBridgeContract.isSupportedRuntimeMessage("GET_MEMORIES"))
        assertTrue(AndroidBridgeContract.isSupportedRuntimeMessage("CREATE_TOOL_AUTHORIZATION"))
        assertTrue(AndroidBridgeContract.isSupportedRuntimeMessage("CLOSE_TOOL_AUTHORIZATION"))
        assertFalse(AndroidBridgeContract.isSupportedRuntimeMessage("EXECUTE_TOOL_CALL"))
        assertFalse(AndroidBridgeContract.isSupportedRuntimeMessage("RUN_ARTIFACT_CODE"))
        assertFalse(AndroidBridgeContract.isSupportedRuntimeMessage("APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK"))
    }
}
