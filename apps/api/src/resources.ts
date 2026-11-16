import { schemas } from './validation';
import { fail } from './auth';
import type { Entry, PrismaClient } from '@prisma/client';
import type { AssetsService } from './assets';
import type { ResourceData, SpaceUser } from './types';
const { daysTogether, anniversaryInfo } = require('@our-little-world/shared/date');
export function today() {return new Intl.DateTimeFormat('sv-SE',{timeZone:process.env.TZ || 'Asia/Shanghai'}).format(new Date());}
export class ResourcesService {
  constructor(private readonly db: PrismaClient, private readonly assets: AssetsService) {}
  async shape(entry: Entry, user: SpaceUser): Promise<ResourceData> {
    const data: ResourceData=JSON.parse(entry.data);
    const result: ResourceData={...data,id:entry.id,authorId:entry.authorId,createdAt:entry.createdAt,updatedAt:entry.updatedAt};
    const author=await this.db.user.findUnique({where:{id:entry.authorId},select:{nickname:true}});
    result.author=author;
    if (entry.kind==='letters') {
      result.isLocked=data.unlockDate>today();
      if(result.isLocked) delete result.content;
    }
    if(data.assetIds) {
      const rows=await this.db.asset.findMany({where:{id:{in:data.assetIds},spaceId:user.spaceId}});
      result.assets=data.assetIds.map(id=>rows.find(a=>a.id===id)).filter(Boolean).map(a=>this.assets.shape(a));
    }
    const assetId=data.assetId||data.avatarId;
    if(assetId) {const asset=await this.db.asset.findFirst({where:{id:assetId,spaceId:user.spaceId}});result.asset=asset?this.assets.shape(asset):null;}
    return result;
  }
  async list(kind: string, user: SpaceUser) {
    const rows=await this.db.entry.findMany({where:{kind,spaceId:user.spaceId},orderBy:{createdAt:'desc'},take:1000});
    return Promise.all(rows.map(row=>this.shape(row,user)));
  }
  async get(kind: string, id: string, user: SpaceUser) {
    const entry=await this.db.entry.findFirst({where:{id,kind,spaceId:user.spaceId}});
    if(!entry) fail(404,'记录不存在');
    return entry;
  }
  async validate(kind: string, input: unknown, user: SpaceUser, existing?: Entry | null): Promise<ResourceData> {
    let data: ResourceData=schemas[kind].parse(input);
    if(kind==='wishes') data.completedAt=data.status==='done'?(data.completedAt||new Date().toISOString()):null;
    if(kind==='letters') {
      if(existing && JSON.parse(existing.data).unlockDate<=today()) fail(409,'已经开启的信件不能再修改');
      if(data.unlockDate<=today()) fail(400,'请选择未来的解锁日期');
    }
    const refs=[...(data.assetIds||[]),data.assetId,data.avatarId].filter(Boolean);
    if(refs.length && await this.db.asset.count({where:{id:{in:[...new Set(refs)]},spaceId:user.spaceId}})!==new Set(refs).size) fail(400,'图片不存在或不属于当前空间');
    if(kind==='orders') {
      const menu=await this.db.entry.findMany({where:{kind:'menu',spaceId:user.spaceId,id:{in:data.items.map(i=>i.menuItemId)}}});
      data.items=data.items.map(item=>{
        const row=menu.find(row=>row.id===item.menuItemId);
        if(!row) fail(400,'菜单已发生变化，请重新选菜');
        const dish=JSON.parse(row.data);
        return {...item,name:dish.name,priceCents:dish.priceCents};
      });
      data.totalCents=data.items.reduce((sum,i)=>sum+i.quantity*i.priceCents,0);
    }
    return data;
  }
  async save(kind: string, user: SpaceUser, input: ResourceData, id?: string) {
    const existing=id?await this.get(kind,id,user):null;
    if(existing && ['letters','moods'].includes(kind) && existing.authorId!==user.id) fail(403,'只能修改自己的记录');
    const merged=existing?{...JSON.parse(existing.data),...input}:input;
    // Order status changes preserve the immutable snapshot if menu items were removed.
    let data;
    if(kind==='orders'&&existing&&Object.keys(input).every(k=>k==='status'||k==='note')) {
      const patch=schemas.orders.pick({status:true,note:true}).partial().parse(input);
      data={...JSON.parse(existing.data),...patch};
    } else data=await this.validate(kind,merged,user,existing);
    if(kind==='moods'&&!id) {
      const rows=await this.db.entry.findMany({where:{kind,spaceId:user.spaceId,authorId:user.id}});
      id=rows.find(row=>JSON.parse(row.data).date===data.date)?.id;
    }
    const entry=id?await this.db.entry.update({where:{id},data:{data:JSON.stringify(data)}}):await this.db.entry.create({data:{kind,data:JSON.stringify(data),spaceId:user.spaceId,authorId:user.id}});
    return this.shape(entry,user);
  }
  async remove(kind: string, user: SpaceUser, id: string) {
    const entry=await this.get(kind,id,user);
    if(['letters','moods'].includes(kind)&&entry.authorId!==user.id) fail(403,'只能删除自己的记录');
    await this.db.entry.delete({where:{id}});
    return {ok:true};
  }
  async baby(user: SpaceUser, body?: ResourceData) {
    const row=await this.db.entry.findFirst({where:{spaceId:user.spaceId,kind:'baby'}});
    if(body===undefined) return row?this.shape(row,user):null;
    return this.save('baby',user,body,row?.id);
  }
  async dashboard(user: SpaceUser) {
    const space=await this.db.space.findUnique({where:{id:user.spaceId}});
    const [wishes,memories,anniversaries,work,ledger,moods]=await Promise.all(['wishes','memories','anniversaries','work','ledger','moods'].map(k=>this.list(k,user)));
    const month=today().slice(0,7);
    const sum=type=>ledger.filter(e=>e.date.startsWith(month)&&e.type===type).reduce((s,e)=>s+e.amountCents,0);
    const incomeCents=sum('income'),expenseCents=sum('expense');
    if (!space) fail(404, '空间不存在');
    return {daysTogether:daysTogether(space.startDate,today()),counts:{wishes:wishes.length,memories:memories.length,anniversaries:anniversaries.length,work:work.length},monthly:{incomeCents,expenseCents,balanceCents:incomeCents-expenseCents},recentMemories:memories.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4),upcomingAnniversaries:anniversaries.map(a=>({...a,...anniversaryInfo(a.date,today(),{recurring:a.recurring})})).sort((a,b)=>a.daysUntil-b.daysUntil).slice(0,4),pendingWishes:wishes.filter(w=>w.status==='todo').slice(0,4),moods:moods.filter(m=>m.date===today())};
  }
}
