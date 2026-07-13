package com.deepseekpp.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidBridgeRequestCodecTest {
    @Test
    fun decodesTheExactVersionOneEnvelope() {
        val request = AndroidBridgeRequestCodec.decode(
            """{"protocol":"deepseek-pp-android-bridge","version":1,"id":"android:1","command":"storage.get","payload":{"keys":[]}}""",
        )
        assertEquals("android:1", request.id)
        assertEquals("storage.get", request.command)
    }

    @Test
    fun rejectsCoercedAndFutureEnvelopeFields() {
        val invalid = listOf(
            """{"protocol":"deepseek-pp-android-bridge","version":"1","id":"android:1","command":"storage.get","payload":{}}""",
            """{"protocol":"deepseek-pp-android-bridge","version":1.0,"id":"android:1","command":"storage.get","payload":{}}""",
            """{"protocol":"deepseek-pp-android-bridge","version":2,"id":"android:1","command":"storage.get","payload":{}}""",
            """{"protocol":"deepseek-pp-android-bridge","version":1,"id":7,"command":"storage.get","payload":{}}""",
            """{"protocol":"deepseek-pp-android-bridge","version":1,"id":"android:1","command":"storage.get","payload":{},"extra":true}""",
            """{'protocol':'deepseek-pp-android-bridge','version':1,'id':'android:1','command':'storage.get','payload':{}}""",
            """{protocol:"deepseek-pp-android-bridge",version:1,id:"android:1",command:"storage.get",payload:{}}""",
            """{"protocol":"deepseek-pp-android-bridge","version":1,"id":"android:1","command":"storage.get","payload":{}} trailing""",
        )
        invalid.forEach { input ->
            val error = assertThrows(AndroidBridgeDecodeException::class.java) {
                AndroidBridgeRequestCodec.decode(input)
            }
            assertEquals("android_bridge_invalid_request", error.code)
        }
    }

    @Test
    fun rejectsUnknownCommandsAndNonObjectPayloads() {
        val unsupported = assertThrows(AndroidBridgeDecodeException::class.java) {
            AndroidBridgeRequestCodec.decode(
                """{"protocol":"deepseek-pp-android-bridge","version":1,"id":"android:1","command":"native.execute","payload":{}}""",
            )
        }
        assertEquals("android_bridge_command_unsupported", unsupported.code)

        val invalidPayload = assertThrows(AndroidBridgeDecodeException::class.java) {
            AndroidBridgeRequestCodec.decode(
                """{"protocol":"deepseek-pp-android-bridge","version":1,"id":"android:1","command":"storage.get","payload":[]}""",
            )
        }
        assertEquals("android_bridge_invalid_payload", invalidPayload.code)
    }
}
