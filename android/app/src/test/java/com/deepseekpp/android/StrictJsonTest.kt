package com.deepseekpp.android

import org.junit.Assert.assertThrows
import org.junit.Test

class StrictJsonTest {
    @Test
    fun acceptsStandardJsonObjectsAndValues() {
        StrictJson.requireObject("""{"string":"line\n\u4e2d","number":-1.5e+2,"array":[true,false,null]}""")
        StrictJson.requireValue(" [1, {\"nested\": \"value\"}] \n")
        StrictJson.requireValue("\"plain\"")
    }

    @Test
    fun rejectsAndroidOrgJsonExtensionsAndTrailingInput() {
        val invalid = listOf(
            "{'key':'value'}",
            "{key:\"value\"}",
            "{\"key\"=\"value\"}",
            "{\"key\":\"value\";}",
            "{/* comment */\"key\":\"value\"}",
            "{\"key\":\"value\"} trailing",
            "01",
            "[1,]",
            """{"key":1,"key":2}""",
            """{"id":1,"\u0069d":2}""",
        )
        invalid.forEach { value ->
            assertThrows(IllegalArgumentException::class.java) {
                StrictJson.requireValue(value)
            }
        }
    }

    @Test
    fun enforcesObjectShapeAtTheEnvelopeBoundary() {
        assertThrows(IllegalArgumentException::class.java) {
            StrictJson.requireObject("[]")
        }
    }
}
