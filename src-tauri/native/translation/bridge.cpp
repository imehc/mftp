#include "bridge.h"
#include "llama.h"
#include "ggml-backend.h"
#include <algorithm>
#include <cstdio>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

namespace {
thread_local std::string diagnostic;
struct Callbacks {
    mftp_cancel cancelled;
    mftp_output output;
    void *user;
    bool stop() const { return cancelled(user); }
};

// Kept between requests so only the first translation pays for loading. Guarded by engine_mutex.
struct Engine {
    std::string path;
    bool legacy = false;
    uint32_t context_size = 0;
    std::unique_ptr<llama_model, decltype(&llama_model_free)> model{nullptr, llama_model_free};
    std::unique_ptr<llama_context, decltype(&llama_free)> context{nullptr, llama_free};
    void release() {
        context.reset();
        model.reset();
        path.clear();
        context_size = 0;
    }
};
std::mutex engine_mutex;
// Intentionally leaked: freeing llama objects during static destruction can outlive ggml's globals.
Engine &engine = *new Engine;

// The cached context must not keep pointing at this request's stack-allocated callbacks.
struct AbortScope {
    llama_context *context;
    ~AbortScope() { llama_set_abort_callback(context, nullptr, nullptr); }
};

int generate(const char *path, const char *prompt, const mftp_translation_params &p,
             Callbacks &callbacks) {
    static std::once_flag initialized;
    std::call_once(initialized, [] {
        llama_log_set([](ggml_log_level level, const char *text, void *) {
            // Bound native diagnostics; never print model metadata or input tokens.
            if (level == GGML_LOG_LEVEL_ERROR && text) {
                diagnostic.append(text, std::min<size_t>(std::char_traits<char>::length(text), 2048));
                if (diagnostic.size() > 4096) diagnostic.erase(0, diagnostic.size() - 4096);
            }
        }, nullptr);
        ggml_backend_load_all();
        llama_backend_init();
    });
    if (callbacks.stop()) return 1;
    std::lock_guard<std::mutex> lock(engine_mutex);
    const bool legacy = p.legacy_stq != 0;
    if (!engine.model || engine.path != path || engine.legacy != legacy) {
        engine.release();
        auto mp = llama_model_default_params();
        mp.n_gpu_layers = 0;
        mp.progress_callback = [](float, void *ptr) { return !static_cast<Callbacks *>(ptr)->stop(); };
        mp.progress_callback_user_data = &callbacks;
        llama_model_kv_override overrides[2] = {};
        if (legacy) {
            std::snprintf(overrides[0].key, sizeof(overrides[0].key), "mftp.legacy_stq1_0");
            overrides[0].tag = LLAMA_KV_OVERRIDE_TYPE_BOOL;
            overrides[0].val_bool = true;
            mp.kv_overrides = overrides;
        }
        engine.model.reset(llama_model_load_from_file(path, mp));
        if (!engine.model) return callbacks.stop() ? 1 : 4;
        engine.path = path;
        engine.legacy = legacy;
    }
    auto *model = engine.model.get();
    const auto *vocab = llama_model_get_vocab(model);
    const auto *tmpl = llama_model_chat_template(model, nullptr);
    if (!tmpl) { diagnostic = "Model has no supported chat template"; return 4; }
    std::string formatted;
    bool add_special = true;
    const std::string_view model_template(tmpl);
    if (model_template.find("<｜hy_begin▁of▁sentence｜>") != std::string_view::npos &&
        model_template.find("<｜hy_User｜>{{ message['content'] }}") != std::string_view::npos &&
        model_template.find("<｜hy_place▁holder▁no▁8｜>") != std::string_view::npos) {
        // The pinned heuristic mistakes HY-MT2 for Hunyuan-VL, reversing the user prefix.
        // Render the model's single-user generation branch, including exactly one BOS.
        formatted = std::string("<｜hy_begin▁of▁sentence｜><｜hy_User｜>") + prompt + "<｜hy_Assistant｜>";
        add_special = false;
    } else {
        llama_chat_message message = {"user", prompt};
        int size = llama_chat_apply_template(tmpl, &message, 1, true, nullptr, 0);
        if (size <= 0 || size > 131072) { diagnostic = "Chat template rejected"; return 4; }
        std::vector<char> buffer(size + 1);
        if (llama_chat_apply_template(tmpl, &message, 1, true, buffer.data(), buffer.size()) != size)
            return 4;
        formatted.assign(buffer.data(), size);
    }
    int count = -llama_tokenize(vocab, formatted.data(), formatted.size(), nullptr, 0, add_special, true);
    if (count <= 0 || uint32_t(count) + p.output > p.context) return 2;
    std::vector<llama_token> tokens(count);
    if (llama_tokenize(vocab, formatted.data(), formatted.size(), tokens.data(), count, add_special, true) != count)
        return 4;
    if (!engine.context || engine.context_size != p.context) {
        engine.context.reset();
        auto cp = llama_context_default_params();
        cp.n_ctx = p.context;
        cp.n_batch = 512;
        cp.n_ubatch = 512;
        cp.n_threads = p.threads;
        cp.n_threads_batch = p.threads;
        engine.context.reset(llama_init_from_model(model, cp));
        if (callbacks.stop()) return 1;
        if (!engine.context) return 4;
        engine.context_size = p.context;
    }
    auto *context = engine.context.get();
    // Each request starts from an empty KV cache; earlier prompts never leak into this one.
    llama_memory_clear(llama_get_memory(context), true);
    llama_set_n_threads(context, p.threads, p.threads);
    llama_set_abort_callback(context, [](void *ptr) { return static_cast<Callbacks *>(ptr)->stop(); },
                             &callbacks);
    AbortScope abort_scope{context};
    for (int start = 0; start < count; start += 512) {
        if (callbacks.stop()) return 1;
        auto batch = llama_batch_get_one(tokens.data() + start, std::min(512, count - start));
        if (llama_decode(context, batch)) return callbacks.stop() ? 1 : 4;
    }
    auto sampler = std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)>(
        llama_sampler_chain_init(llama_sampler_chain_default_params()), llama_sampler_free);
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_penalties(
        llama_vocab_n_tokens(vocab), 64, p.repeat_penalty, 0, 0));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_top_k(p.top_k));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_top_p(p.top_p, 1));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_temp(p.temperature));
    llama_sampler_chain_add(sampler.get(), llama_sampler_init_dist(p.seed));
    for (uint32_t generated = 0; generated < p.output; ++generated) {
        if (callbacks.stop()) return 1;
        auto token = llama_sampler_sample(sampler.get(), context, -1);
        if (llama_vocab_is_eog(vocab, token)) return 0;
        std::vector<char> piece(256);
        int bytes = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, false);
        if (bytes < 0) {
            if (bytes < -65536) return 4;
            piece.resize(-bytes);
            bytes = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, false);
        }
        if (bytes < 0) return 4;
        if (!callbacks.output(callbacks.user, piece.data(), bytes)) return 1;
        if (generated + 1 < p.output) {
            auto batch = llama_batch_get_one(&token, 1);
            if (llama_decode(context, batch)) return callbacks.stop() ? 1 : 4;
        }
    }
    return 3;
}
}

extern "C" void mftp_translation_release(void) {
    std::lock_guard<std::mutex> lock(engine_mutex);
    engine.release();
}

extern "C" int mftp_translate(const char *path, const char *prompt, const mftp_translation_params *p,
                              mftp_cancel cancel, mftp_output output, void *user,
                              char *error, size_t capacity) {
    diagnostic.clear();
    int result = 4;
    try {
        if (!path || !prompt || !p || !cancel || !output || p->context < 512 ||
            p->context > 4096 || p->output == 0 || p->output >= p->context ||
            p->threads == 0 || p->threads > 8) {
            diagnostic = "Invalid translation engine parameters";
        } else {
            Callbacks callbacks{cancel, output, user};
            result = generate(path, prompt, *p, callbacks);
        }
    } catch (const std::exception &exception) {
        diagnostic = exception.what();
    } catch (...) {
        diagnostic = "Unknown native translation failure";
    }
    if (error && capacity)
        std::snprintf(error, capacity, "%s", diagnostic.empty() ? "Native translation failed" : diagnostic.c_str());
    return result;
}
