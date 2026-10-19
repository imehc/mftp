#pragma once
#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif
typedef struct {
    uint32_t context;
    uint32_t output;
    uint32_t threads;
    uint32_t seed;
    int32_t top_k;
    float top_p;
    float temperature;
    float repeat_penalty;
    uint8_t legacy_stq;
} mftp_translation_params;
typedef bool (*mftp_cancel)(void *);
typedef bool (*mftp_output)(void *, const char *, size_t);
// 0: complete, 1: cancelled, 2: input budget, 3: output limit, 4: engine error.
int mftp_translate(const char *, const char *, const mftp_translation_params *,
                   mftp_cancel, mftp_output, void *, char *, size_t);
// Frees the model and context kept between requests; waits for a running request.
void mftp_translation_release(void);
#ifdef __cplusplus
}
#endif
