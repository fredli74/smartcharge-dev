<template>
  <v-flex xs12 class="svga-limit">
    <v-card v-if="!limited">
      <v-list-item
        v-for="provider in providers"
        :key="provider.name"
        @click="addProvider(provider.name)"
      >
        <v-list-item-avatar tile>
          <img :src="provider.logo" />
        </v-list-item-avatar>

        <v-list-item-content>
          <v-list-item-title>{{ provider.display }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
    </v-card>
    <h2 v-else class="text-center text--darken-1 error--text">
      Vehicle limit for this beta has been reached
    </h2>
  </v-flex>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import providers from "@providers/provider-apps";
import apollo from "@app/plugins/apollo";

@Component({
  components: {}
})
export default class Add extends Vue {
  limited!: boolean;
  async mounted() {
    const limit = await apollo.getVehicleLimit();
    console.debug(limit);
    this.limited = limit !== null && limit <= 0;
  }
  data() {
    return {
      limited: false
    };
  }
  get providers() {
    return providers.filter(f => f.type === this.$route.params.type);
  }
  addProvider(name: string) {
    this.$router.replace({
      path: `/provider/${name}/new`,
      query: this.$route.query
    });
  }
}
</script>
