package br.com.faceponto.terminal.sync

import android.content.Context
import android.os.SystemClock
import br.com.faceponto.terminal.clock.BootIdentity
import br.com.faceponto.terminal.storage.PunchEventEntity
import br.com.faceponto.terminal.storage.TerminalDatabase
import java.time.Instant
import java.util.UUID

object OfflineProbe {
    suspend fun enqueue(context: Context): String {
        val dao = TerminalDatabase.open(context).punches()
        val employee = requireNotNull(dao.offlineProbeEmployee()) { "Sonda sintética ausente do catálogo" }
        val terminal = requireNotNull(dao.terminalCatalogState()) { "Estado do terminal ausente" }
        val boot = BootIdentity(context).current()
        val anchor = requireNotNull(dao.latestClockAnchor(boot.id)) { "Âncora do relógio ausente" }
        val elapsed = SystemClock.elapsedRealtime()
        val deviceTime = Instant.parse(anchor.serverTimestamp).plusMillis(elapsed - anchor.deviceElapsedMs).toString()
        val eventId = UUID.randomUUID().toString()
        dao.persistCapturedPunch(PunchEventEntity(
            id = eventId, employeeId = employee.id, terminalAssignmentId = terminal.terminalAssignmentId,
            deviceTimestamp = deviceTime, deviceElapsedMs = elapsed, bootId = boot.id, clockAnchorId = anchor.id,
            profileId = requireNotNull(employee.serverProfileId), profileVersion = requireNotNull(employee.serverProfileVersion),
            recognitionModelSha256 = requireNotNull(employee.recognitionModelSha256),
            livenessModelSha256 = requireNotNull(employee.livenessModelSha256), policyVersion = requireNotNull(employee.policyVersion),
            livenessSessionId = UUID.randomUUID().toString(), createdAtMs = System.currentTimeMillis(),
        ))
        TerminalSyncWorker.schedule(context)
        return eventId
    }
}
