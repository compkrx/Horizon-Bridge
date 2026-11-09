package fixture;

// Deliberately synthetic names used to test static capability evidence.
public final class Capabilities {
    public static Class<?>[] registrations() {
        return new Class<?>[] {
            HudRenderCallback.class, KeyMapping.class, ForgeConfigSpec.class,
            RegisterCommandFixture.class, RenderType.class, ClientTickCallback.class,
            CustomPayload.class
        };
    }

    static final class HudRenderCallback {}
    static final class KeyMapping {}
    static final class ForgeConfigSpec {}
    static final class RegisterCommandFixture {}
    static final class RenderType {}
    static final class ClientTickCallback {}
    static final class CustomPayload {}
}
