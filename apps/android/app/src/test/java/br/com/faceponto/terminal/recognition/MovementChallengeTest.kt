package br.com.faceponto.terminal.recognition

import org.junit.Assert.assertEquals
import org.junit.Test

class MovementChallengeTest {
    @Test fun `requires frontal then both randomized sides and frontal confirmation`() {
        var state = MovementChallengeState(firstWasLeft = true)
        state = advance(state, .50f, 100)
        assertEquals(MovementStep.FIRST_SIDE, state.step)
        state = advance(state, .30f, 500)
        assertEquals(MovementStep.OPPOSITE_SIDE, state.step)
        state = advance(state, .70f, 900)
        assertEquals(MovementStep.FINAL_CENTER, state.step)
        state = advance(state, .50f, 1_300)
        assertEquals(MovementStep.COMPLETE, state.step)
        assertEquals(true, ActivePresencePolicy.passed(state))
    }

    @Test fun `expires an unfinished challenge`() {
        var state = MovementChallengeState(firstWasLeft = false)
        state = advance(state, .50f, 100)
        assertEquals(MovementStep.FIRST_SIDE, state.step)
        assertEquals(true, state.timedOut(12_103))
        assertEquals(false, ActivePresencePolicy.passed(state))
    }

    private fun advance(start: MovementChallengeState, yaw: Float, startedAt: Long): MovementChallengeState {
        var state = start
        repeat(3) { state = state.advance(face(yaw), true, startedAt + it) }
        return state
    }

    private fun face(yaw: Float) = FaceObservation(count = 1, confidence = .99f, usable = true, yawRatio = yaw)
}
