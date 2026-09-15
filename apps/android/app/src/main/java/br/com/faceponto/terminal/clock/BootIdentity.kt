package br.com.faceponto.terminal.clock

import android.content.Context
import android.provider.Settings
import java.util.UUID

data class CurrentBoot(val id: String, val systemCount: Int)

class BootIdentity(private val context: Context) {
    private val preferences = context.getSharedPreferences("device_clock", Context.MODE_PRIVATE)

    fun current(): CurrentBoot {
        val count = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
        val storedCount = preferences.getInt("boot_count", Int.MIN_VALUE)
        val storedId = preferences.getString("boot_id", null)
        if (storedId != null && count == storedCount) return CurrentBoot(storedId, count)
        val id = UUID.randomUUID().toString()
        check(preferences.edit().putInt("boot_count", count).putString("boot_id", id).commit())
        return CurrentBoot(id, count)
    }
}
