package com.magicapi.gitsync;

import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.PullResult;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.transport.CredentialsProvider;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.ssssssss.magicapi.core.config.MagicAPIProperties;
import org.ssssssss.magicapi.core.service.MagicResourceService;
import org.ssssssss.magicapi.git.MagicGitProperties;

import java.io.File;

/**
 * MagicAPI Git 同步服务
 * <p>
 * magic-api 的 git 插件默认只在应用启动时拉取远程仓库，运行期间推送到远程的代码
 * 不会自动生效。此服务执行一次 git pull，检测到有新提交时调用
 * {@link MagicResourceService#refresh()} 将最新脚本重新加载进内存，
 * 从而无需重启应用即可在 Web 页面看到最新代码。
 * <p>
 * 仅提供手动触发能力（由编辑器工具栏"拉取"按钮调用），不做定时轮询。
 */
public class MagicGitSyncService {

    private static final Logger log = LoggerFactory.getLogger(MagicGitSyncService.class);

    private final MagicGitProperties gitProperties;

    private final MagicAPIProperties magicAPIProperties;

    private final MagicResourceService magicResourceService;

    public MagicGitSyncService(MagicGitProperties gitProperties,
                               MagicAPIProperties magicAPIProperties,
                               MagicResourceService magicResourceService) {
        this.gitProperties = gitProperties;
        this.magicAPIProperties = magicAPIProperties;
        this.magicResourceService = magicResourceService;
    }

    /**
     * 执行一次 git pull，若有新提交则刷新内存中的接口
     *
     * @return true 表示拉取到了新代码并已重新加载
     */
    public boolean sync() throws Exception {
        File rootDir = new File(magicAPIProperties.getResource().getLocation());
        if (!new File(rootDir, ".git").exists()) {
            // 本地仓库尚未克隆（首次启动时由 git 插件自行克隆），跳过
            return false;
        }
        try (Git git = Git.open(rootDir)) {
            ObjectId before = git.getRepository().resolve("HEAD");
            CredentialsProvider credentials = new UsernamePasswordCredentialsProvider(
                    gitProperties.getUsername(), gitProperties.getPassword());
            PullResult result = git.pull()
                    .setRemote("origin")
                    .setRemoteBranchName(gitProperties.getBranch())
                    .setCredentialsProvider(credentials)
                    .call();
            if (!result.isSuccessful()) {
                log.warn("MagicAPI Git 拉取未成功");
                return false;
            }
            ObjectId after = git.getRepository().resolve("HEAD");
            // HEAD 发生变化说明远程有新提交，重新加载内存中的接口
            if (before == null || !before.equals(after)) {
                magicResourceService.refresh();
                log.info("MagicAPI 已同步 Git 最新代码并重新加载接口, head={}", after.getName());
                return true;
            }
        }
        return false;
    }
}
