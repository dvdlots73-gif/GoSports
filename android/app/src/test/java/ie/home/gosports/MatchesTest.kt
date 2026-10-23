package ie.home.gosports

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Real ESPN data: Premier League, 18 Oct 2026 (Bournemouth 2-0 Sunderland with a red card, Brighton 5-0 Palace with an own goal). */
class MatchesTest {
    private val matches = parseMatches(JSONObject(javaClass.getResource("/pl-2026-10-18.json")!!.readText()))
    private val bournemouth = matches.first { it.home.short == "Bournemouth" }

    @Test fun parsesGoalsAndCards() {
        assertEquals("Bournemouth 2–0 Sunderland", bournemouth.score)
        assertEquals(listOf("goal", "red", "yellow", "yellow", "yellow", "goal", "yellow", "yellow"), bournemouth.events.map { it.kind })
        assertEquals("M. Tavernier 6'", bournemouth.events[0].text)
        assertEquals("K. Danso (Sunderland) 17'", bournemouth.events[1].text)
        assertEquals("J. Canvot 4' (og)", matches.first { it.home.short == "Brighton" }.events[0].text)
    }

    @Test fun firstSightIsSilent() {
        val (alerts, snap) = diff(null, bournemouth)
        assertTrue(alerts.isEmpty())
        assertEquals(8, snap.seen.size)
    }

    @Test fun alertsOnlyForWhatsNew() {
        // As if we last looked at kick-off: everything after is new, ending with full-time.
        val (alerts, snap) = diff(Snap("in", false, emptySet()), bournemouth)
        assertEquals("⚽ GOAL! Bournemouth 2–0 Sunderland", alerts[0].title)
        assertEquals("M. Tavernier 6'", alerts[0].body)
        assertEquals("🟥 Red card – K. Danso (Sunderland) 17'", alerts[1].title)
        assertEquals(Alert("Full-time", "Bournemouth 2–0 Sunderland"), alerts.last())
        assertEquals(9, alerts.size) // 2 goals + 1 red + 5 yellows + full-time
        // Same data again: nothing new.
        assertTrue(diff(Snap.fromJson(snap.toJson()), bournemouth).first.isEmpty())
    }

    @Test fun kickOffAndHalfTime() {
        val pre = Snap("pre", false, emptySet())
        val live = bournemouth.copy(state = "in", status = "STATUS_HALFTIME", events = emptyList())
        assertEquals(listOf("Kick-off", "Half-time"), diff(pre, live).first.map { it.title })
    }

    @Test fun postponedIsNotFullTime() {
        val off = bournemouth.copy(state = "post", status = "STATUS_POSTPONED", events = emptyList())
        assertEquals("Not played", diff(Snap("pre", false, emptySet()), off).first.single().title)
    }
}
