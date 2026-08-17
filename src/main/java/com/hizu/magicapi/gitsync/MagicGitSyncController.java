package com.hizu.magicapi.gitsync;

import org.ssssssss.magicapi.core.context.MagicUser;
import org.ssssssss.magicapi.core.interceptor.AuthorizationInterceptor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * MagicAPI Git 手动同步接口
 * <p>
 * 供编辑器右上角的"拉取"按钮调用，立即执行 git pull 并刷新内存接口。
 * 鉴权复用编辑器登录态：请求携带编辑器统一的 Magic-Token 请求头，
 * 与内置 /reload 走同一套校验，无需额外配置秘钥；未登录时按钮不会渲染，接口也拒绝访问。
 */
@RestController
public class MagicGitSyncController {

    /** 编辑器登录态 token 请求头（magic-api 编辑器所有请求统一携带） */
    private static final String TOKEN_HEADER = "Magic-Token";

    private final MagicGitSyncService magicGitSyncService;

    private final AuthorizationInterceptor authorizationInterceptor;

    public MagicGitSyncController(MagicGitSyncService magicGitSyncService,
                                  AuthorizationInterceptor authorizationInterceptor) {
        this.magicGitSyncService = magicGitSyncService;
        this.authorizationInterceptor = authorizationInterceptor;
    }

    /**
     * 路径位于 magic-api.web（/magic/web）之外，不会进入编辑器自身的请求映射，
     * 编辑器页面内以相对路径 ../git-sync 即可访问。
     */
    @PostMapping("/magic/git-sync")
    public Map<String, Object> gitSync(@RequestHeader(value = TOKEN_HEADER, required = false) String token) {
        Map<String, Object> result = new HashMap<>();
        MagicUser user = null;
        if (token != null && !token.isEmpty()) {
            try {
                user = authorizationInterceptor.getUserByToken(token);
            } catch (Exception ignored) {
                // token 无效或已过期，按未登录处理
            }
        }
        if (user == null) {
            result.put("code", 401);
            result.put("message", "未登录或登录已过期，请先登录编辑器");
            return result;
        }
        try {
            boolean updated = magicGitSyncService.sync();
            result.put("code", 200);
            result.put("message", updated ? "已同步最新代码并重新加载接口" : "已是最新代码，无需更新");
        } catch (Exception e) {
            result.put("code", 500);
            result.put("message", "同步失败：" + e.getMessage());
        }
        return result;
    }
}
