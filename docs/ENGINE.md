# Java inspection and translation

HorizonRelay reads the JAR archive and class-file structures directly. It never loads a submitted class into the JVM. The optional Vineflower stage reconstructs Java as a review aid. The deterministic translator uses the original bytecode so the result does not depend on the decompiler's formatting or inferred names.

| Input | Recovered evidence |
| --- | --- |
| Fabric | Mod descriptor, dependencies, declared entrypoints, and Mixin files |
| Quilt | Loader and contributor metadata, dependency groups, declared entrypoints, and Mixin files |
| Forge and NeoForge | TOML metadata, required dependencies, JAR manifest version, and class-level `@Mod` annotations |
| Legacy Java | `mcmod.info`, legacy loader manifest entries, and recognizable Minecraft classes |
| Resource archive | Minecraft assets and data inventory when there are no recognized loader descriptors or classes |

When a JAR has multiple loader descriptors, the report identifies the primary descriptor used. The dependency list reports declared IDs. Required third-party Java dependencies appear as unmapped because HorizonRelay does not resolve Java libraries against Horizon. Nested JARs, Forge access transformers, Mixin targets, and loader registrations require separate review. Feature detection from class references is heuristic and may miss obfuscated or dynamically loaded code.

## Translated methods

The deterministic rule accepts small static methods with `int`, `long`, `short`, `byte`, `char`, and `boolean` parameters and return values. It supports JVM constants, locals, signed integer arithmetic, comparisons, branches, and loops. For `int` it also supports bitwise operations, shifts, narrow conversions, and the integer overloads of Java `Math.abs`, `Math.min`, and `Math.max`. The branch verifier checks instruction boundaries, stack types and JVM slot widths, and definite local assignment before generating Rust.

A translated method with signed division or remainder returns `Result<T, JavaArithmeticError>`. A zero divisor returns `Err(JavaArithmeticError::DivisionByZero)` for Java's `ArithmeticException`. Quotients truncate toward zero, a nonzero remainder takes the dividend's sign, and the minimum signed value divided by −1 wraps. Its remainder is zero.

The source archive contains `bytecode-ir.json` with the bounded class and method inventory. Supported methods have numbered JVM operations and unsupported methods include a reason. Long constants are decimal strings so JavaScript readers preserve all 64 bits. `src/translated.rs`, when present, contains standalone Rust bodies with stable names. Review their callers, class initialization, state, and game bindings before integrating them. Java exception handlers, JVM object behavior, collections, string processing, reflection, and arbitrary Java API calls require manual translation. Multi-release overrides and Java preview classes are outside the deterministic rule set.

The native rule recognizes a single Fabric client initializer whose only side effect is printing a constant string. It rejects additional classes, fields, methods, resources, custom language adapters, dependencies outside the platform, Mixin settings, and nested JARs. The Horizon client-start hook can fire at a different time than the Fabric initializer. [Horizon integration and exact target](HORIZON.md)

## Limits and checks

- Input archives can be up to 32 MiB, with at most 10,000 members and 96 MiB of expanded content. A single member can be up to 16 MiB. The ZIP directory, path components, compression ratio, and decompression stream are bounded. The inspector checks all member CRCs and rejects ambiguous paths, links, encrypted entries, and split archives.
- Class analysis covers up to 3,000 classes, 2 MiB per class, and 32 MiB of class content. Translation considers up to 2,400 methods and approximately 18,000 decoded operations per archive. A translated method can have up to 512 bytes of JVM instructions and up to 32 local and operand stack slots. The report records skipped input.
- Java SE 26 class-file major version 70 is the current rule ceiling. The parser can report a newer class-file major when its existing structure is readable. It leaves the method bodies out of the translation.
- The fixture tests compile original Java source and check loader detection, the exact hook rule, malformed archives, Zip Slip paths, oversized expansion, unsupported capabilities, and invalid control flow. With Rust installed, they also compile the generated code and exercise mixed-width arithmetic, signed division and remainder, zero-divisor errors, overflow, branches, loops, shifts, conversions, and Boolean returns.

Class layouts and opcode semantics follow the JVM specification. Loader fields come from the corresponding project documentation. [JVM class files](https://docs.oracle.com/en/java/javase/26/docs/specs/jvms/jvms-4.html) · [JVM instructions](https://docs.oracle.com/en/java/javase/26/docs/specs/jvms/jvms-6.html) · [Fabric metadata](https://docs.fabricmc.net/develop/loader/fabric-mod-json) · [Quilt metadata](https://github.com/QuiltMC/rfcs/blob/main/specification/0002-quilt.mod.json.md) · [Forge metadata](https://docs.minecraftforge.net/en/1.20.1/gettingstarted/modfiles/) · [NeoForge metadata](https://docs.neoforged.net/docs/gettingstarted/modfiles/)
