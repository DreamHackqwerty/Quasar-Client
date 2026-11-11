package dev.quasar.module;

public enum Category {
    HUD("HUD"),
    RENDER("Render"),
    MOVEMENT("Movement");

    public final String displayName;

    Category(String displayName) {
        this.displayName = displayName;
    }
}
