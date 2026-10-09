import { identity, secureWrite, apiError, ApiError } from '@/lib/server';
import { CalendarFetchError } from '@/lib/safe-calendar-fetch';
import { listCalendarSources,addCalendarSource,setCalendarSourceEnabled,removeCalendarSource,refreshCalendarSource,calendarSourceEvents,holidaySourceStatus,holidaysEnabled,setHolidaysEnabled,refreshHolidaySource,CalendarSourceError } from '@/lib/calendar-source-service';
function failure(error:unknown){if(error instanceof CalendarSourceError||error instanceof CalendarFetchError)return Response.json({error:error.message},{status:error instanceof CalendarSourceError?error.status:400});return apiError(error instanceof ApiError?error:error)}
export async function GET(request:Request){try{const user=await identity(request),url=new URL(request.url);const result={sources:await listCalendarSources(user.userId),holidays:await holidaySourceStatus(user.userId),events:url.searchParams.has('from')?await calendarSourceEvents(user.userId,url.searchParams.get('from')!,url.searchParams.get('through')||'',url.searchParams.get('timeZone')||'UTC'):[]};return Response.json(result)}catch(error){return failure(error)}}
export async function POST(request:Request){try{secureWrite(request);const user=await identity(request);const input=await request.json();if(!input||typeof input!=='object')throw new ApiError('无效请求。');
 switch(input.action){
 case'add':await addCalendarSource(user.userId,input);break;
 case'refresh':if(typeof input.id!=='string')throw new ApiError('日历ID无效。');await refreshCalendarSource(user.userId,input.id,{manual:true});break;
 case'enable':if(typeof input.id!=='string'||typeof input.enabled!=='boolean')throw new ApiError('日历设置无效。');await setCalendarSourceEnabled(user.userId,input.id,input.enabled);break;
 case'remove':if(typeof input.id!=='string')throw new ApiError('日历ID无效。');await removeCalendarSource(user.userId,input.id);break;
 case'holidays':if(typeof input.enabled!=='boolean')throw new ApiError('调休设置无效。');await setHolidaysEnabled(user.userId,input.enabled);break;
 case'refresh-holidays':if(!await holidaysEnabled(user.userId))throw new ApiError('请先主动启用中国节假日与调休。');await refreshHolidaySource();break;
 default:throw new ApiError('不支持的日历操作。');
 }
 return Response.json({sources:await listCalendarSources(user.userId),holidays:await holidaySourceStatus(user.userId)});
 }catch(error){return failure(error)}}
