package br.com.faceponto.terminal.sync

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.*
import br.com.faceponto.terminal.auth.CredentialStore
import br.com.faceponto.terminal.clock.BootIdentity
import br.com.faceponto.terminal.network.TerminalApi
import br.com.faceponto.terminal.storage.CatalogEmployeeEntity
import br.com.faceponto.terminal.storage.ClockAnchorEntity
import br.com.faceponto.terminal.storage.TerminalDatabase
import br.com.faceponto.terminal.storage.TerminalCatalogStateEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit
import android.os.SystemClock

class TerminalSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        runCatching {
            val dao = TerminalDatabase.open(applicationContext).punches()
            val api = TerminalApi(CredentialStore(applicationContext))
            val pingStart = SystemClock.elapsedRealtime()
            api.heartbeat(dao.pendingCount())
            val pingEnd = SystemClock.elapsedRealtime()
            val boot = BootIdentity(applicationContext).current()
            val anchor = api.clockAnchor(boot.id, pingEnd, ((pingEnd - pingStart) / 2).toInt())
            dao.saveClockAnchor(ClockAnchorEntity(anchor.getString("id"), boot.id, anchor.getString("server_timestamp"),
                pingEnd, ((pingEnd - pingStart) / 2).toInt(), anchor.getString("expires_at")))
            val catalogResponse = api.catalog()
            val catalog = catalogResponse.getJSONArray("employees")
            val now = System.currentTimeMillis()
            dao.replaceCatalog((0 until catalog.length()).map { index -> catalog.getJSONObject(index).run {
                CatalogEmployeeEntity(getString("id"), getString("name"), getInt("version"), now,
                    if (isNull("profile_id")) null else optString("profile_id").ifBlank { null }, if (isNull("profile_version")) null else getInt("profile_version"),
                    if (isNull("recognition_model_sha256")) null else optString("recognition_model_sha256").ifBlank { null }, if (isNull("liveness_model_sha256")) null else optString("liveness_model_sha256").ifBlank { null },
                    if (isNull("policy_version")) null else getInt("policy_version"))
            } }, TerminalCatalogStateEntity(terminalAssignmentId = catalogResponse.getString("terminal_assignment_id"),
                terminalAssignmentVersion = catalogResponse.getInt("terminal_assignment_version"),
                locationId = catalogResponse.getString("location_id"), updatedAtMs = now))
            Log.i("FacePontoSync", "catalog_loaded employees=${catalog.length()} policy_versions=" +
                (0 until catalog.length()).joinToString(",") { index -> catalog.getJSONObject(index).optInt("policy_version", -1).toString() })
            val pending = dao.pendingEvents(now)
            if (pending.isNotEmpty()) {
                val results = api.sync(pending)
                for (index in 0 until results.length()) results.getJSONObject(index).run {
                    when (getString("status")) {
                        "accepted", "already_received" -> dao.finishSync(getString("id"), "synced", optString("receipt_id").ifBlank { null }, null)
                        "quarantined" -> dao.finishSync(getString("id"), "quarantined", optString("receipt_id").ifBlank { null }, optString("code"))
                        "rejected" -> {
                            val code = optString("code")
                            dao.finishSync(getString("id"), "rejected", null, code)
                            if (code == PUNCH_ALREADY_REGISTERED) {
                                applicationContext.sendBroadcast(Intent(ACTION_PUNCH_REJECTED)
                                    .setPackage(applicationContext.packageName)
                                    .putExtra(EXTRA_RESULT_CODE, code))
                            }
                        }
                        "retry" -> dao.retryLater(getString("id"), now + getLong("retry_after_seconds") * 1000)
                    }
                }
                api.heartbeat(dao.pendingCount())
            }
        }.fold(onSuccess = { Result.success() }, onFailure = {
            if (it is CancellationException) throw it
            Log.w("FacePontoSync", "sync failed: ${it.javaClass.simpleName}: ${it.message}")
            if (runAttemptCount < 8) Result.retry() else Result.failure()
        })
    }

    companion object {
        const val ACTION_PUNCH_REJECTED = "br.com.faceponto.terminal.PUNCH_REJECTED"
        const val EXTRA_RESULT_CODE = "result_code"
        const val PUNCH_ALREADY_REGISTERED = "PUNCH_ALREADY_REGISTERED"
        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        fun refreshNow(context: Context) {
            WorkManager.getInstance(context).enqueueUniqueWork("terminal-sync-now", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<TerminalSyncWorker>().setConstraints(network).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS).build())
        }
        fun schedule(context: Context) {
            val manager = WorkManager.getInstance(context)
            refreshNow(context)
            manager.enqueueUniquePeriodicWork("terminal-sync-periodic", ExistingPeriodicWorkPolicy.UPDATE,
                PeriodicWorkRequestBuilder<TerminalSyncWorker>(15, TimeUnit.MINUTES).setConstraints(network).build())
        }
    }
}
