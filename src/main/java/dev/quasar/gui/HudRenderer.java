package dev.quasar.gui;

import dev.quasar.module.ModuleManager;
import dev.quasar.module.hud.ArmorHud;
import dev.quasar.module.hud.Coordinates;
import dev.quasar.module.hud.FpsDisplay;
import dev.quasar.module.hud.Keystrokes;
import dev.quasar.module.hud.ModuleList;
import dev.quasar.module.hud.Watermark;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.ClientPlayerEntity;

/** Lays out every HUD module: info stack top-left, module list top-right, armor by the hotbar. */
public final class HudRenderer {
    private HudRenderer() {}

    public static void render(DrawContext ctx) {
        MinecraftClient mc = MinecraftClient.getInstance();
        ClientPlayerEntity player = mc.player;
        if (player == null || mc.options.hudHidden || mc.inGameHud.getDebugHud().shouldShowDebugHud()) return;

        TextRenderer tr = mc.textRenderer;
        int x = 4;
        int y = 4;

        if (ModuleManager.isOn(Watermark.class)) y = ModuleManager.get(Watermark.class).render(ctx, tr, x, y);
        if (ModuleManager.isOn(FpsDisplay.class)) y = ModuleManager.get(FpsDisplay.class).render(ctx, tr, x, y);
        if (ModuleManager.isOn(Coordinates.class)) y = ModuleManager.get(Coordinates.class).render(ctx, tr, player, x, y);
        if (ModuleManager.isOn(Keystrokes.class)) ModuleManager.get(Keystrokes.class).render(ctx, tr, x, y + 4);

        if (ModuleManager.isOn(ModuleList.class)) ModuleManager.get(ModuleList.class).render(ctx, tr);
        if (ModuleManager.isOn(ArmorHud.class)) ModuleManager.get(ArmorHud.class).render(ctx, tr, player);
    }
}
