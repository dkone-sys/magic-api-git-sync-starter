package com.hizu.magicapi.gitsync;

import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * 禁止浏览器缓存编辑器自定义配置脚本（/magic/web/config-js）。
 * <p>
 * magic-api 返回该脚本时不带缓存控制头，浏览器可能缓存旧内容，
 * 导致插件升级后注入脚本不更新。
 */
public class MagicConfigJsNoCacheFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String uri = request.getRequestURI();
        if (uri != null && uri.contains("/magic/web/config-js")) {
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("Pragma", "no-cache");
        }
        filterChain.doFilter(request, response);
    }
}
