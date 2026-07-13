package com.deepseekpp.android

import android.content.Context

internal interface AndroidPreferenceStore {
    fun read(key: String): String?

    fun write(values: Map<String, String>): Boolean

    fun remove(keys: Collection<String>): Boolean
}

internal class SharedPreferencesAndroidPreferenceStore(context: Context) : AndroidPreferenceStore {
    private val prefs = context.getSharedPreferences(
        AndroidBridgeContract.SHARED_PREFERENCES,
        Context.MODE_PRIVATE,
    )

    override fun read(key: String): String? = prefs.getString(key, null)

    override fun write(values: Map<String, String>): Boolean {
        val editor = prefs.edit()
        for ((key, value) in values) editor.putString(key, value)
        return editor.commit()
    }

    override fun remove(keys: Collection<String>): Boolean {
        val editor = prefs.edit()
        for (key in keys) editor.remove(key)
        return editor.commit()
    }
}
