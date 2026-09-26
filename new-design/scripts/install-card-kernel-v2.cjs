'use strict';
// Historical 123–131 SQL remains in source for provenance, never in the startup path.
console.error('旧库收敛安装入口已停用。当前方案是先完成纯表代码，再显式初始化独立空库跑完整流程。请使用 db:init-card-kernel；该命令也不会清空当前作者库。');
process.exitCode=1;
