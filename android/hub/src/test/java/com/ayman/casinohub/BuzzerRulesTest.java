package com.ayman.casinohub;

import org.junit.Test;
import static org.junit.Assert.*;

public final class BuzzerRulesTest {
    @Test public void onlyFirstArrivalGetsAnswerRights() {
        BuzzerRules r = new BuzzerRules();
        r.open();
        assertNull(r.buzz("a", 1));
        assertEquals("answering", r.phase);
        assertEquals("الجرس مقفول", r.buzz("b", 1));
        assertEquals("a", r.correct());
        assertEquals("closed", r.phase);
    }

    @Test public void wrongAnswerReopensForAllIncludingSamePlayer() {
        BuzzerRules r = new BuzzerRules();
        r.open();
        assertNull(r.buzz("a", r.roundId));
        assertEquals("a", r.wrong(true));
        assertEquals("open", r.phase);
        assertEquals("ضغطة من جولة قديمة", r.buzz("b", 1));
        assertNull(r.buzz("a", r.roundId));
        assertEquals("a", r.correct());
        r.open();
        assertNull(r.buzz("b", r.roundId));
    }

    @Test public void noConnectedPlayersClosesAfterWrong() {
        BuzzerRules r = new BuzzerRules();
        r.open();
        assertNull(r.buzz("only", r.roundId));
        r.wrong(false);
        assertEquals("closed", r.phase);
    }

    @Test public void hostMustHaveSomeoneAnsweringBeforeJudging() {
        BuzzerRules r = new BuzzerRules();
        try { r.correct(); fail("should reject"); }
        catch (IllegalStateException expected) { assertTrue(expected.getMessage().contains("مفيش")); }
        try { r.wrong(true); fail("should reject"); }
        catch (IllegalStateException expected) { assertTrue(expected.getMessage().contains("مفيش")); }
    }
}
