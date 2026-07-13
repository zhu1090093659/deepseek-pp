package com.deepseekpp.android

internal object StrictJson {
    fun requireObject(value: String) {
        Parser(value).parse(requireObject = true)
    }

    fun requireValue(value: String) {
        Parser(value).parse(requireObject = false)
    }

    private class Parser(private val input: String) {
        private var index = 0

        fun parse(requireObject: Boolean) {
            skipWhitespace()
            if (requireObject && peek() != '{') fail()
            parseValue(depth = 0)
            skipWhitespace()
            if (index != input.length) fail()
        }

        private fun parseValue(depth: Int) {
            if (depth > MAX_DEPTH) fail()
            when (peek()) {
                '{' -> parseObject(depth + 1)
                '[' -> parseArray(depth + 1)
                '"' -> parseString()
                't' -> consumeLiteral("true")
                'f' -> consumeLiteral("false")
                'n' -> consumeLiteral("null")
                else -> if (peek() == '-' || isDigit(peek())) parseNumber() else fail()
            }
        }

        private fun parseObject(depth: Int) {
            consume('{')
            skipWhitespace()
            if (consumeIf('}')) return
            val keys = mutableSetOf<String>()
            while (true) {
                if (peek() != '"') fail()
                if (!keys.add(parseString())) fail()
                skipWhitespace()
                consume(':')
                skipWhitespace()
                parseValue(depth)
                skipWhitespace()
                if (consumeIf('}')) return
                consume(',')
                skipWhitespace()
            }
        }

        private fun parseArray(depth: Int) {
            consume('[')
            skipWhitespace()
            if (consumeIf(']')) return
            while (true) {
                parseValue(depth)
                skipWhitespace()
                if (consumeIf(']')) return
                consume(',')
                skipWhitespace()
            }
        }

        private fun parseString(): String {
            consume('"')
            val result = StringBuilder()
            while (index < input.length) {
                val value = input[index++]
                when {
                    value == '"' -> return result.toString()
                    value == '\\' -> result.append(parseEscape())
                    value.code < 0x20 -> fail()
                    else -> result.append(value)
                }
            }
            fail()
        }

        private fun parseEscape(): Char {
            if (index >= input.length) fail()
            return when (val escape = input[index++]) {
                '"', '\\', '/' -> escape
                'b' -> '\b'
                'f' -> '\u000C'
                'n' -> '\n'
                'r' -> '\r'
                't' -> '\t'
                'u' -> {
                    var codePoint = 0
                    repeat(4) {
                        val digit = if (index < input.length) {
                            input[index++].digitToIntOrNull(16)
                        } else {
                            null
                        } ?: fail()
                        codePoint = (codePoint shl 4) or digit
                    }
                    codePoint.toChar()
                }
                else -> fail()
            }
        }

        private fun parseNumber() {
            consumeIf('-')
            when (val first = peek()) {
                '0' -> {
                    index++
                    if (isDigit(peek())) fail()
                }
                null -> fail()
                else -> if (first in '1'..'9') consumeDigits() else fail()
            }
            if (consumeIf('.')) {
                if (!isDigit(peek())) fail()
                consumeDigits()
            }
            if (peek() == 'e' || peek() == 'E') {
                index++
                if (peek() == '+' || peek() == '-') index++
                if (!isDigit(peek())) fail()
                consumeDigits()
            }
        }

        private fun consumeDigits() {
            while (isDigit(peek())) index++
        }

        private fun consumeLiteral(value: String) {
            if (!input.startsWith(value, index)) fail()
            index += value.length
        }

        private fun skipWhitespace() {
            while (peek() == ' ' || peek() == '\t' || peek() == '\r' || peek() == '\n') index++
        }

        private fun consume(expected: Char) {
            if (!consumeIf(expected)) fail()
        }

        private fun consumeIf(expected: Char): Boolean {
            if (peek() != expected) return false
            index++
            return true
        }

        private fun peek(): Char? = input.getOrNull(index)

        private fun isDigit(value: Char?): Boolean = value != null && value in '0'..'9'

        private fun fail(): Nothing = throw IllegalArgumentException("Invalid JSON")
    }

    private const val MAX_DEPTH = 64
}
