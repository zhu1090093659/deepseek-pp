package com.deepseekpp.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeepSeekNavigationPolicyTest {
    @Test
    fun acceptsOnlyCanonicalHttpsOriginAsInternal() {
        val legal = listOf(
            "https://chat.deepseek.com",
            "https://chat.deepseek.com/",
            "HTTPS://CHAT.DEEPSEEK.COM/chat/s/one?x=1#answer",
            "https://chat.deepseek.com:443/chat/s/one",
        )
        legal.forEach { url -> assertTrue(url, DeepSeekNavigationPolicy.isTrustedOrigin(url)) }
    }

    @Test
    fun neverTreatsLookalikesCredentialsOrOtherPortsAsInternal() {
        val invalid = listOf(
            "http://chat.deepseek.com",
            "https://chat.deepseek.com:444",
            "https://chat.deepseek.com.evil.example",
            "https://evil-chat.deepseek.com",
            "https://chat.deepseek.com@evil.example",
            "javascript:alert(1)",
            "not a url",
            " https://chat.deepseek.com",
            "https://chat.deepseek.com ",
        )
        invalid.forEach { url -> assertFalse(url, DeepSeekNavigationPolicy.isTrustedOrigin(url)) }
    }

    @Test
    fun classifiesOnlySafeExternalSchemesForIntentLaunch() {
        assertEquals(
            DeepSeekNavigationPolicy.Destination.EXTERNAL,
            DeepSeekNavigationPolicy.classify("https://example.com/path"),
        )
        assertEquals(
            DeepSeekNavigationPolicy.Destination.EXTERNAL,
            DeepSeekNavigationPolicy.classify("mailto:support@example.com"),
        )
        assertEquals(
            DeepSeekNavigationPolicy.Destination.REJECT,
            DeepSeekNavigationPolicy.classify("file:///data/local/tmp/secret"),
        )
        assertEquals(
            DeepSeekNavigationPolicy.Destination.REJECT,
            DeepSeekNavigationPolicy.classify("intent://scan/#Intent;scheme=zxing;end"),
        )
    }
}
