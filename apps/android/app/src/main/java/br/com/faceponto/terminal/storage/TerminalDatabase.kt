package br.com.faceponto.terminal.storage

import android.content.Context
import androidx.room.*

@Entity(tableName = "punch_events")
data class PunchEventEntity(
    @PrimaryKey val id: String,
    val employeeId: String,
    val terminalAssignmentId: String,
    val deviceTimestamp: String,
    val deviceElapsedMs: Long,
    val bootId: String,
    val clockAnchorId: String?,
    val profileId: String,
    val profileVersion: Int,
    val recognitionModelSha256: String,
    val livenessModelSha256: String,
    val policyVersion: Int,
    val livenessSessionId: String,
    val createdAtMs: Long,
)

@Entity(
    tableName = "sync_outbox",
    foreignKeys = [ForeignKey(
        entity = PunchEventEntity::class,
        parentColumns = ["id"], childColumns = ["eventId"],
        onDelete = ForeignKey.RESTRICT,
    )],
    indices = [Index("eventId", unique = true), Index("nextAttemptAtMs")],
)
data class OutboxEntity(
    @PrimaryKey(autoGenerate = true) val sequence: Long = 0,
    val eventId: String,
    val attempts: Int = 0,
    val nextAttemptAtMs: Long = 0,
    val state: String = "pending",
    val receiptId: String? = null,
    val lastResultCode: String? = null,
)

@Entity(tableName = "employee_catalog")
data class CatalogEmployeeEntity(
    @PrimaryKey val id: String, val name: String, val version: Int, val updatedAtMs: Long,
    val serverProfileId: String? = null, val serverProfileVersion: Int? = null,
    val recognitionModelSha256: String? = null, val livenessModelSha256: String? = null,
    val policyVersion: Int? = null,
)

@Entity(tableName = "terminal_catalog_state")
data class TerminalCatalogStateEntity(
    @PrimaryKey val singletonId: Int = 1,
    val terminalAssignmentId: String,
    val terminalAssignmentVersion: Int,
    val locationId: String,
    val updatedAtMs: Long,
)

@Entity(tableName = "clock_anchors", indices = [Index("bootId"), Index("expiresAt")])
data class ClockAnchorEntity(
    @PrimaryKey val id: String,
    val bootId: String,
    val serverTimestamp: String,
    val deviceElapsedMs: Long,
    val uncertaintyMs: Int,
    val expiresAt: String,
)

@Entity(tableName = "facial_profiles")
data class FacialProfileEntity(
    @PrimaryKey val employeeId: String,
    val encryptedEmbedding: ByteArray,
    val modelSha256: String,
    val version: Int,
    val createdAtMs: Long,
)

data class FacialProfileCandidate(
    val employeeId: String,
    val employeeName: String,
    val encryptedEmbedding: ByteArray,
    val modelSha256: String,
    val version: Int,
)

@Dao
interface PunchDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertEvent(event: PunchEventEntity)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertOutbox(item: OutboxEntity)

    @Transaction
    suspend fun persistCapturedPunch(event: PunchEventEntity) {
        insertEvent(event)
        insertOutbox(OutboxEntity(eventId = event.id))
    }

    @Query("SELECT * FROM sync_outbox WHERE state = 'pending' AND nextAttemptAtMs <= :now ORDER BY sequence LIMIT :limit")
    suspend fun pending(now: Long, limit: Int = 100): List<OutboxEntity>

    @Query("SELECT p.* FROM punch_events p JOIN sync_outbox o ON o.eventId=p.id WHERE o.state='pending' AND o.nextAttemptAtMs<=:now ORDER BY o.sequence LIMIT :limit")
    suspend fun pendingEvents(now: Long, limit: Int = 100): List<PunchEventEntity>

    @Query("SELECT COUNT(*) FROM sync_outbox WHERE state = 'pending'")
    suspend fun pendingCount(): Int

    @Query("DELETE FROM employee_catalog")
    suspend fun clearCatalog()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCatalog(employees: List<CatalogEmployeeEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveTerminalCatalogState(state: TerminalCatalogStateEntity)

    @Transaction
    suspend fun replaceCatalog(employees: List<CatalogEmployeeEntity>, state: TerminalCatalogStateEntity) {
        clearCatalog(); insertCatalog(employees); saveTerminalCatalogState(state)
    }

    @Query("SELECT COUNT(*) FROM employee_catalog")
    suspend fun catalogCount(): Int

    @Query("SELECT * FROM employee_catalog ORDER BY name LIMIT 1")
    suspend fun firstCatalogEmployee(): CatalogEmployeeEntity?

    @Query("SELECT * FROM employee_catalog WHERE id=:employeeId LIMIT 1")
    suspend fun catalogEmployee(employeeId: String): CatalogEmployeeEntity?

    @Query("SELECT * FROM employee_catalog WHERE name='Sonda offline sintética' LIMIT 1")
    suspend fun offlineProbeEmployee(): CatalogEmployeeEntity?

    @Query("SELECT * FROM terminal_catalog_state WHERE singletonId=1")
    suspend fun terminalCatalogState(): TerminalCatalogStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveFacialProfile(profile: FacialProfileEntity)

    @Query("SELECT COUNT(*) FROM facial_profiles")
    suspend fun facialProfileCount(): Int

    @Query("SELECT fp.employeeId, e.name AS employeeName, fp.encryptedEmbedding, fp.modelSha256, fp.version FROM facial_profiles fp JOIN employee_catalog e ON e.id = fp.employeeId")
    suspend fun facialProfileCandidates(): List<FacialProfileCandidate>

    @Query("UPDATE sync_outbox SET state=:state, receiptId=:receiptId, lastResultCode=:code WHERE eventId=:eventId")
    suspend fun finishSync(eventId: String, state: String, receiptId: String?, code: String?)

    @Query("UPDATE sync_outbox SET attempts=attempts+1, nextAttemptAtMs=:nextAttempt WHERE eventId=:eventId AND state='pending'")
    suspend fun retryLater(eventId: String, nextAttempt: Long)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveClockAnchor(anchor: ClockAnchorEntity)

    @Query("SELECT * FROM clock_anchors WHERE bootId=:bootId ORDER BY deviceElapsedMs DESC LIMIT 1")
    suspend fun latestClockAnchor(bootId: String): ClockAnchorEntity?
}

@Database(entities = [PunchEventEntity::class, OutboxEntity::class, CatalogEmployeeEntity::class, ClockAnchorEntity::class, FacialProfileEntity::class, TerminalCatalogStateEntity::class], version = 5, exportSchema = true,
    autoMigrations = [AutoMigration(from = 1, to = 2), AutoMigration(from = 2, to = 3), AutoMigration(from = 3, to = 4), AutoMigration(from = 4, to = 5)])
abstract class TerminalDatabase : RoomDatabase() {
    abstract fun punches(): PunchDao

    companion object {
        @Volatile private var instance: TerminalDatabase? = null
        fun open(context: Context): TerminalDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext, TerminalDatabase::class.java, "faceponto-terminal.db",
            ).build().also { instance = it }
        }
    }
}
