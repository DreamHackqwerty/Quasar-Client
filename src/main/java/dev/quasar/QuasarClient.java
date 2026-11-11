package dev.quasar;

import dev.quasar.gui.ClickGuiScreen;
import dev.quasar.gui.HudRenderer;
import dev.quasar.module.Module;
import dev.quasar.module.ModuleManager;
import dev.quasar.module.render.Fullbright;
import dev.quasar.module.render.Zoom;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class QuasarClient implements ClientModInitializer {
    public static final String NAME = "Quasar";
    public static final String VERSION = "1.0.0";
    public static final Logger LOG = LoggerFactory.getLogger(NAME);

    private static KeyBinding guiKey;
    private static KeyBinding zoomKey;

    @Override
    public void onInitializeClient() {
        ModuleManager.init();
        Config.load();

        guiKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.quasar.gui", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_RIGHT_SHIFT, "category.quasar"));
        zoomKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.quasar.zoom", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_C, "category.quasar"));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (guiKey.wasPressed()) {
                client.setScreen(new ClickGuiScreen());
            }
            ModuleManager.get(Zoom.class).setHeld(zoomKey.isPressed());

            for (Module module : ModuleManager.all()) {
                if (module.isEnabled()) module.onTick(client);
            }
        });

        HudRenderCallback.EVENT.register((context, tickCounter) -> HudRenderer.render(context));

        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> {
            // Put the real brightness back so options.txt never stores the fullbright value.
            ModuleManager.get(Fullbright.class).restore();
            Config.save();
        });

        LOG.info("{} {} loaded with {} modules", NAME, VERSION, ModuleManager.all().size());
    }
}
