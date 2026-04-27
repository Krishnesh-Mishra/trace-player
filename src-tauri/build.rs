use std::path::Path;

fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let assets = Path::new(&manifest).join("assets");

    // Tell the linker to search src-tauri/assets/ for the mpv import library.
    // GNU toolchain: finds libmpv.dll.a  -> links against libmpv-2.dll at runtime.
    // MSVC toolchain: needs mpv.lib (see note below).
    println!("cargo:rustc-link-search=native={}", assets.display());
    println!("cargo:rustc-link-lib=mpv");

    // The DLL is embedded in the .exe via include_bytes! in dll_bootstrap.rs.
    // Re-run the build if the user drops in a newer libmpv build.
    println!(
        "cargo:rerun-if-changed={}",
        assets.join("libmpv-2.dll").display()
    );

    // MSVC: delay-load libmpv-2.dll so its imports are not resolved at exe
    // load time. dll_bootstrap.rs extracts the embedded DLL to
    // %LOCALAPPDATA%\TracePlayer\bin\ and LoadLibraryW-preloads it before any
    // libmpv FFI call, so the deferred resolution finds the cache copy.
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("pc-windows-msvc") {
        println!("cargo:rustc-link-arg-bins=/DELAYLOAD:libmpv-2.dll");
        println!("cargo:rustc-link-arg-bins=delayimp.lib");
    }

    // NOTE — MSVC toolchain users:
    // libmpv.dll.a is a MinGW import library; MSVC link.exe cannot use it.
    // You need mpv.lib. Generate it from the DLL using a VS Developer Command Prompt:
    //   gendef libmpv-2.dll              (creates libmpv-2.def)
    //   lib /DEF:libmpv-2.def /MACHINE:X64 /OUT:mpv.lib
    // Then place mpv.lib in src-tauri/assets/.
    //
    // Alternatively, switch to the GNU Rust toolchain for this project:
    //   rustup toolchain install stable-x86_64-pc-windows-gnu
    //   rustup override set stable-x86_64-pc-windows-gnu

    tauri_build::build()
}
