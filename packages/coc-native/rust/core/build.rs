fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=NAPI_TYPE_DEF_TMP_FOLDER");
    println!("cargo:rerun-if-env-changed=NAPI_FORCE_BUILD_COC_NATIVE_CORE");
}
