package com.ayman.casinohub;

/** Deterministic rules shared by every connected phone. Never trusts client timestamps. */
public final class BuzzerRules {
    public String phase = "idle";
    public int roundId = 0;
    public String winnerId = null;
    public String lastEvent = "جاهزين لبدء اللعب";

    public void open() {
        phase = "open";
        roundId++;
        winnerId = null;
        lastEvent = "الجرس مفتوح — الجولة " + roundId;
    }

    public String buzz(String playerId, int submittedRoundId) {
        if (!"open".equals(phase)) return "الجرس مقفول";
        if (roundId != submittedRoundId) return "ضغطة من جولة قديمة";
        winnerId = playerId;
        phase = "answering";
        lastEvent = "فيه لاعب كسب الجرس";
        return null;
    }

    public String correct() {
        if (!"answering".equals(phase) || winnerId == null) {
            throw new IllegalStateException("مفيش لاعب بيجاوب حاليًا");
        }
        String winner = winnerId;
        phase = "closed";
        return winner;
    }

    public String wrong(boolean anyoneConnected) {
        if (!"answering".equals(phase) || winnerId == null) {
            throw new IllegalStateException("مفيش لاعب بيجاوب حاليًا");
        }
        String previous = winnerId;
        winnerId = null;
        roundId++; // all previous-round packets are invalid now
        phase = anyoneConnected ? "open" : "closed";
        return previous; // the same player can buzz again in the new round
    }

    public void close() {
        phase = "closed";
        winnerId = null;
        lastEvent = "المذيع قفل الجرس";
    }

    public void reset() {
        roundId = 0;
        phase = "idle";
        winnerId = null;
        lastEvent = "تم حذف اللاعبين وإعادة ضبط الغرفة";
    }
}
