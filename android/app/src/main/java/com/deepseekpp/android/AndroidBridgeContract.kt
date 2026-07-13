package com.deepseekpp.android

object AndroidBridgeContract {
    const val BRIDGE_NAME = "AndroidBridge"
    const val PROTOCOL = "deepseek-pp-android-bridge"
    const val VERSION = 1
    const val SHARED_PREFERENCES = "deepseek_pp_android"
    const val MAX_REQUEST_CHARS = 128 * 1024
    const val MAX_STORAGE_VALUE_CHARS = 64 * 1024
    const val MAX_STORAGE_KEYS_PER_REQUEST = 16

    val commands = setOf(
        "runtime.sendMessage",
        "storage.get",
        "storage.set",
        "storage.remove",
    )

    val storageKeys = setOf(
        "deepseek_pp_locale_preference",
        "deepseek_pp_floating_chat_enabled",
        "deepseek_pp_history_organizer",
    )

    const val THEME_STORAGE_KEY = "deepseek_theme"

    val runtimeMessageTypes = setOf(
        "GET_MEMORIES",
        "GET_SKILLS",
        "GET_ACTIVE_PRESET",
        "GET_MODEL_TYPE",
        "GET_TOOL_DESCRIPTORS",
        "GET_PROMPT_INJECTION_SETTINGS",
        "GET_MCP_SERVERS",
        "CREATE_TOOL_AUTHORIZATION",
        "CLOSE_TOOL_AUTHORIZATION",
        "GET_PROJECT_CONTEXT_FOR_CONVERSATION",
        "GET_BACKGROUND",
        "GET_PET",
        "GET_PLATFORM_CAPABILITIES",
        "GET_DEEPSEEK_THEME",
        "SET_DEEPSEEK_THEME",
        "TOUCH_MEMORIES",
    )

    fun isSupportedCommand(command: String): Boolean = command in commands

    fun isAllowedStorageKey(key: String): Boolean = key in storageKeys

    fun isSupportedRuntimeMessage(type: String): Boolean = type in runtimeMessageTypes
}
