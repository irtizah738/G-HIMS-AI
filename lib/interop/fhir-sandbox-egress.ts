/**
 * CI-EXT-06 public sandbox egress preflight.
 *
 * Exact allowlisted DNS hosts and globally routable addresses are required.
 * This check is defense-in-depth: DNS can change between lookup and connect.
 * Production operator MUST additionally enforce the same policy at the
 * egress gateway/proxy and prohibit direct workload internet escape.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

type Resolved = { address: string; family: number };
const isPublicIpv4 = (ip: string): boolean => {
  const octets=ip.split('.').map(Number);
  if(octets.length!==4||octets.some(v=>!Number.isInteger(v)||v<0||v>255))return false;
  const [a,b,c]=octets;
  if(a===0||a===10||a===127||a>=224||a===169&&b===254||
     a===100&&b>=64&&b<=127||a===172&&b>=16&&b<=31||
     a===192&&b===168||a===192&&b===0||
     a===198&&(b===18||b===19)||
     a===192&&b===0&&c===2||
     a===198&&b===51&&c===100||
     a===203&&b===0&&c===113) return false;
  return true;
};
export function publicSandboxAddress(address:string):boolean {
  const family=isIP(address);
  if(family===4)return isPublicIpv4(address);
  if(family!==6)return false;
  const value=address.toLowerCase();
  // All v4-mapped, loopback, private, link-local, translation/tunnel and
  // documentation forms are disallowed, even if syntactically valid IPv6.
  if(!/^[23][0-9a-f]{0,3}:/.test(value)||
     value.startsWith('2001:db8:')||
     value.startsWith('2001:0:')||
     value.startsWith('2002:')||
     value.startsWith('2001:20:')||
     value.startsWith('2001:10:'))return false;
  return true;
}
export async function assertPublicSandboxEgress(args:{
  url:string;
  allowedHosts:readonly string[];
  resolve?: (hostname:string)=>Promise<Resolved[]>;
}):Promise<void>{
  let url:URL;
  try{url=new URL(args.url);}catch{throw new Error('CI_EXT06_EGRESS_ORIGIN_DENIED');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||
     url.port||url.hash||url.search||!host||
     isIP(host)!==0||
     !args.allowedHosts.some(h=>h.toLowerCase()===host)){
    throw new Error('CI_EXT06_EGRESS_ORIGIN_DENIED');
  }
  const resolve=args.resolve|| (async(hostname:string)=>
    (await lookup(hostname,{all:true})).map(r=>({
      address:r.address,family:r.family,
    })));
  let records:Resolved[];
  try{records=await resolve(host);}catch{
    throw new Error('CI_EXT06_EGRESS_DNS_UNAVAILABLE');
  }
  if(!records.length||records.length>16||
     records.some(r=>r.family!==isIP(r.address)||!publicSandboxAddress(r.address))){
    throw new Error('CI_EXT06_EGRESS_ADDRESS_DENIED');
  }
}
