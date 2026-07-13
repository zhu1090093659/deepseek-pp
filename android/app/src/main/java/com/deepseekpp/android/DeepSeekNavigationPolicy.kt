package com.deepseekpp.android

import java.net.URI

object DeepSeekNavigationPolicy {
    const val TRUSTED_ORIGIN = "https://chat.deepseek.com"

    enum class Destination {
        INTERNAL,
        EXTERNAL,
        REJECT,
    }

    fun classify(rawUrl: String?): Destination {
        val value = rawUrl.orEmpty()
        if (value.isEmpty()) return Destination.REJECT

        val uri = try {
            URI(value)
        } catch (_: Exception) {
            return Destination.REJECT
        }
        val scheme = uri.scheme?.lowercase() ?: return Destination.REJECT

        if (scheme == "mailto" || scheme == "tel") {
            return if (uri.rawSchemeSpecificPart.isNullOrBlank()) Destination.REJECT else Destination.EXTERNAL
        }
        if (scheme != "http" && scheme != "https") return Destination.REJECT
        if (uri.isOpaque || uri.userInfo != null) return Destination.REJECT

        val host = uri.host?.lowercase() ?: return Destination.REJECT
        val port = uri.port
        if (port < -1 || port > 65_535) return Destination.REJECT

        val isTrusted = scheme == "https" &&
            host == TRUSTED_HOST &&
            (port == -1 || port == HTTPS_PORT)
        return if (isTrusted) Destination.INTERNAL else Destination.EXTERNAL
    }

    fun isTrustedOrigin(rawUrl: String?): Boolean = classify(rawUrl) == Destination.INTERNAL

    private const val TRUSTED_HOST = "chat.deepseek.com"
    private const val HTTPS_PORT = 443
}
