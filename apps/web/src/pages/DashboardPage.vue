<script setup>
import {ref,onMounted} from 'vue';import {useSession} from '../stores/session';import {api} from '../api';import HouseArt from '../components/HouseArt.vue';
const session=useSession(),data=ref(null),error=ref(''),loading=ref(true);async function load(){loading.value=true;try{data.value=await api.get('/dashboard');}catch(e){error.value=e.message;}finally{loading.value=false;}}onMounted(load);
</script>
<template><PageHeader title="平凡日子，也闪闪发光" description="这里收藏着我们的小事，和所有值得期待的明天。"/><LoadState :loading="loading" :error="error" @retry="load"><section class="home-hero panel"><div><p class="eyebrow">TOGETHER IS A BEAUTIFUL PLACE</p><h2>{{session.space?.name}}</h2><p>我们在一起的第 <strong>{{data?.daysTogether||0}}</strong> 天</p><span class="hero-caption">一屋两人，三餐四季。<br>慢慢来，我们还有好多好多天。</span></div><HouseArt/></section></LoadState></template>
