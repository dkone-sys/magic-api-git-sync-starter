package com.magicapi.gitsync;

import org.eclipse.jgit.api.Git;
import org.ssssssss.magicapi.core.config.MagicAPIProperties;
import org.ssssssss.magicapi.core.interceptor.AuthorizationInterceptor;
import org.ssssssss.magicapi.core.service.MagicResourceService;
import org.ssssssss.magicapi.git.MagicGitProperties;
import org.springframework.boot.autoconfigure.AutoConfigureAfter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * MagicAPI Git 手动同步插件自动配置
 * <p>
 * 接入方式：项目引入本 starter，且 magic-api 已启用 git 存储
 * （magic-api.resource.type=git）即自动生效，无需任何额外配置。
 * <p>
 * 关闭方式：magic-api.git-sync.enabled=false
 */
@Configuration
@ConditionalOnClass({MagicGitProperties.class, Git.class})
@ConditionalOnBean(MagicGitProperties.class)
@AutoConfigureAfter(name = {
        "org.ssssssss.magicapi.spring.boot.starter.MagicAPIAutoConfiguration",
        "org.ssssssss.magicapi.git.MagicGitConfiguration"
})
@ConditionalOnProperty(name = "magic-api.git-sync.enabled", havingValue = "true", matchIfMissing = true)
public class MagicGitSyncAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public MagicGitSyncService magicGitSyncService(MagicGitProperties gitProperties,
                                                   MagicAPIProperties magicAPIProperties,
                                                   MagicResourceService magicResourceService) {
        return new MagicGitSyncService(gitProperties, magicAPIProperties, magicResourceService);
    }

    @Bean
    @ConditionalOnMissingBean
    public MagicGitSyncController magicGitSyncController(MagicGitSyncService magicGitSyncService,
                                                         AuthorizationInterceptor authorizationInterceptor) {
        return new MagicGitSyncController(magicGitSyncService, authorizationInterceptor);
    }

    /**
     * 禁止浏览器缓存编辑器配置脚本（config-js），
     * 保证升级插件后刷新页面即可加载到最新的注入脚本
     */
    @Bean
    @ConditionalOnMissingBean
    public MagicConfigJsNoCacheFilter magicConfigJsNoCacheFilter() {
        return new MagicConfigJsNoCacheFilter();
    }
}
