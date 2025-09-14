// controllers/group.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { genJoinCode } from '../utils/joinCode';

const prisma = new PrismaClient();

export const createGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { name } = req.body;
    if (!userId || !name) return res.status(400).json({ message: '缺少 userId 或 name' });

    let code: string | null = null;
    for (let i = 0; i < 5; i++) {
      const c = genJoinCode(6);
      const exists = await prisma.group.findUnique({ where: { joinCode: c } });
      if (!exists) { code = c; break; }
    }
    if (!code) return res.status(500).json({ message: '產生加入代碼失敗' });

    const group = await prisma.$transaction(async (tx) => {
      const g = await tx.group.create({ data: { name, joinCode: code } });
      await tx.groupMember.create({ data: { groupId: g.id, userId, role: 'admin' } });
      return g;
    });

    return res.status(201).json(group);
  } catch (err) {
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

export const getMyGroupsWithCode = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: '未登入' });

    const groups = await prisma.group.findMany({
      where: { members: { some: { userId } } },
      select: {
        id: true,
        name: true,
        joinCode: true,
        updatedAt: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
      orderBy: { id: 'desc' },
    });

    const withCounts = groups.map(g => ({
      id: g.id,
      name: g.name,
      joinCode: g.joinCode,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      memberCount: g._count.members,
      membersCount: g._count.members,
    }));

    return res.json(withCounts);
  } catch (err) {
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

export const regenJoinCode = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const groupId = parseInt(req.params.id);
    if (!userId || !groupId) return res.status(400).json({ message: '缺少 userId 或 groupId' });

    const gm = await prisma.groupMember.findFirst({ where: { groupId, userId } });
    if (!gm) return res.status(403).json({ message: '非群組成員' });
    if (gm.role !== 'admin') return res.status(403).json({ message: '僅管理員可重生代碼' });

    let code: string | null = null;
    for (let i = 0; i < 5; i++) {
      const c = genJoinCode(6);
      const exists = await prisma.group.findUnique({ where: { joinCode: c } });
      if (!exists) { code = c; break; }
    }
    if (!code) return res.status(500).json({ message: '產生加入代碼失敗' });

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: { joinCode: code },
      select: { id: true, name: true, joinCode: true },
    });

    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

export const joinByCode = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const raw = (req.body?.joinCode || '').toString();
    if (!userId || !raw) return res.status(400).json({ message: '缺少 userId 或 joinCode' });

    const joinCode = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(joinCode)) return res.status(400).json({ message: '代碼格式不正確' });

    const group = await prisma.group.findUnique({ where: { joinCode } });
    if (!group) return res.status(404).json({ message: '代碼不存在或已失效' });

    const exists = await prisma.groupMember.findFirst({ where: { groupId: group.id, userId } });
    if (exists) {
      const cnt0 = await prisma.groupMember.count({ where: { groupId: group.id } });
      return res.status(200).json({ message: '已在群組中', groupId: group.id, memberCount: cnt0, membersCount: cnt0 });
    }

    await prisma.groupMember.create({ data: { groupId: group.id, userId, role: 'member' } });
    const cnt = await prisma.groupMember.count({ where: { groupId: group.id } });

    return res.status(201).json({ message: '加入成功', groupId: group.id, memberCount: cnt, membersCount: cnt });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const group = await prisma.group.findUnique({ where: { joinCode: (req.body?.joinCode || '').toString().trim().toUpperCase() } });
      const cnt = group ? await prisma.groupMember.count({ where: { groupId: group.id } }) : 0;
      return res.status(200).json({ message: '已在群組中', memberCount: cnt, membersCount: cnt });
    }
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

export const getGroupMembers = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const groupId = Number(req.params.id);
    if (!userId || !groupId) return res.status(400).json({ message: '缺少 userId 或 groupId' });

    const me = await prisma.groupMember.findFirst({ where: { groupId, userId } });
    if (!me) return res.status(403).json({ message: '非群組成員' });

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      orderBy: [{ role: 'desc' }, { id: 'asc' }],
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    return res.json({ memberCount: members.length, membersCount: members.length, members });
  } catch (err) {
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

export const getGroupDetail = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const groupId = Number(req.params.id);
    if (!userId || !groupId) return res.status(400).json({ message: '缺少 userId 或 groupId' });

    const me = await prisma.groupMember.findFirst({ where: { groupId, userId } });
    if (!me) return res.status(403).json({ message: '非群組成員' });

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        joinCode: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true } },
      },
    });
    if (!group) return res.status(404).json({ message: '群組不存在' });

    return res.json({
      id: group.id,
      name: group.name,
      joinCode: group.joinCode,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      memberCount: group._count.members,
      membersCount: group._count.members,
      myRole: me.role,
    });
  } catch (err) {
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};

/** --------------------------
 *  DELETE /groups/:id  或  POST /groups/delete
 *  - admin：刪除整個群組
 *  - member：離開群組（若剩 0 人則清理群組）
 * ------------------------- */
export const deleteGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    // 支援 params 與 body 兩種傳入
    const groupId = Number(req.params.id ?? req.body?.id ?? req.body?.groupId);
    if (!userId || !groupId) return res.status(400).json({ message: '缺少 userId 或 groupId' });

    const membership = await prisma.groupMember.findFirst({ where: { groupId, userId } });
    if (!membership) return res.status(403).json({ message: '非群組成員' });

    if (membership.role === 'admin') {
      // 管理員：直接刪整個群組（先刪 members 再刪 group）
      await prisma.$transaction(async (tx) => {
        // TODO: 若你有其他表有 groupId 外鍵（例如 splits/expenses/records），在這裡一併 tx.deleteMany(...)
        await tx.groupMember.deleteMany({ where: { groupId } });
        await tx.group.delete({ where: { id: groupId } });
      });
      return res.json({ message: '群組已刪除', groupId });
    }

    // 一般成員：僅退出
    await prisma.groupMember.deleteMany({ where: { groupId, userId } });

    // 如果已無成員，順手清理群組
    const left = await prisma.groupMember.count({ where: { groupId } });
    if (left === 0) {
      await prisma.group.delete({ where: { id: groupId } });
      return res.json({ message: '已退出，群組無成員而一併刪除', groupId });
    }

    return res.json({ message: '已退出群組', groupId });
  } catch (err) {
    return res.status(500).json({ message: '伺服器錯誤' });
  }
};
