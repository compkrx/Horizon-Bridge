package net.fabricmc.api;

// Fixture-only interface. The compiled copy is excluded from the mod JAR.
public interface ClientModInitializer {
    void onInitializeClient();
}
