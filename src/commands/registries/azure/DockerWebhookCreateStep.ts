/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ContainerRegistryManagementClient from 'azure-arm-containerregistry';
import { Webhook, WebhookCreateParameters } from 'azure-arm-containerregistry/lib/models';
import { Site } from 'azure-arm-website/lib/models';
import { Progress } from "vscode";
import * as vscode from "vscode";
import { IAppServiceWizardContext, SiteClient } from "vscode-azureappservice";
import { AzureWizardExecuteStep, createAzureClient } from "vscode-azureextensionui";
import { ext } from "../../../extensionVariables";
import { AzureRegistryTreeItem } from '../../../tree/registries/azure/AzureRegistryTreeItem';
import { AzureRepositoryTreeItem } from '../../../tree/registries/azure/AzureRepositoryTreeItem';
import { DockerHubRepositoryTreeItem } from '../../../tree/registries/dockerHub/DockerHubRepositoryTreeItem';
import { RemoteTagTreeItem } from '../../../tree/registries/RemoteTagTreeItem';
import { nonNullProp } from "../../../utils/nonNull";
import { openExternal } from '../../../utils/openExternal';
import { randomUtils } from '../../../utils/randomUtils';

export class DockerWebhookCreateStep extends AzureWizardExecuteStep<IAppServiceWizardContext> {
    public priority: number = 141; // execute after DockerSiteCreate
    private _treeItem: RemoteTagTreeItem;
    public constructor(treeItem: RemoteTagTreeItem) {
        super();
        this._treeItem = treeItem;
    }

    public async execute(context: IAppServiceWizardContext, progress: Progress<{
        message?: string;
        increment?: number;
    }>): Promise<void> {
        const site: Site = nonNullProp(context, 'site');
        let siteClient = new SiteClient(site, context);
        let appUri: string = (await siteClient.getWebAppPublishCredential()).scmUri;
        if (this._treeItem.parent instanceof AzureRepositoryTreeItem) {
            const creatingNewWebhook: string = `Creating webhook for web app "${context.newSiteName}"...`;
            ext.outputChannel.appendLine(creatingNewWebhook);
            progress.report({ message: creatingNewWebhook });
            const webhook = await this.createWebhookForApp(this._treeItem, context.site, appUri);
            ext.outputChannel.appendLine(`Created webhook "${webhook.name}" with scope "${webhook.scope}", id: "${webhook.id}" and location: "${webhook.location}"`);
        } else if (this._treeItem.parent instanceof DockerHubRepositoryTreeItem) {
            // point to dockerhub to create a webhook
            // http://cloud.docker.com/repository/docker/<registryName>/<repoName>/webHooks
            const dockerhubPrompt: string = "Copy & Open";
            const dockerhubUri: string = `https://cloud.docker.com/repository/docker/${this._treeItem.parent.parent.namespace}/${this._treeItem.parent.repoName}/webHooks`;

            // NOTE: The response to the information message is not awaited but handled independently of the wizard steps.
            //       VS Code will hide such messages in the notifications pane after a period of time; awaiting them risks
            //       the user never noticing them in the first place, which means the wizard would never complete, and the
            //       user left with the impression that the action is hung.

            /* eslint-disable-next-line @typescript-eslint/no-floating-promises */
            vscode.window
                .showInformationMessage(`To set up a CI/CD webhook, open the page "${dockerhubUri}" and enter the URI to the created web app in your dockerhub account`, dockerhubPrompt)
                .then(response => {
                    if (response) {
                        /* eslint-disable-next-line @typescript-eslint/no-floating-promises */
                        vscode.env.clipboard.writeText(appUri);

                        /* eslint-disable-next-line @typescript-eslint/no-floating-promises */
                        openExternal(dockerhubUri);
                    }
                });
        }
    }

    public shouldExecute(context: IAppServiceWizardContext): boolean {
        return !!context.site && (this._treeItem.parent instanceof AzureRepositoryTreeItem || this._treeItem.parent instanceof DockerHubRepositoryTreeItem);
    }

    private async createWebhookForApp(node: RemoteTagTreeItem, site: Site, appUri: string): Promise<Webhook | undefined> {
        const maxLength: number = 50;
        const numRandomChars: number = 6;

        let webhookName: string = site.name;
        // remove disallowed characters
        webhookName = webhookName.replace(/[^a-zA-Z0-9]/g, '');
        // trim to max length
        webhookName = webhookName.substr(0, maxLength - numRandomChars);
        // add random chars for uniqueness and to ensure min length is met
        webhookName += randomUtils.getRandomHexString(numRandomChars);

        // variables derived from the container registry
        const registryTreeItem: AzureRegistryTreeItem = (<AzureRepositoryTreeItem>node.parent).parent;
        const crmClient = createAzureClient(registryTreeItem.parent.root, ContainerRegistryManagementClient);
        let webhookCreateParameters: WebhookCreateParameters = {
            location: registryTreeItem.registryLocation,
            serviceUri: appUri,
            scope: `${node.parent.repoName}:${node.tag}`,
            actions: ["push"],
            status: 'enabled'
        };
        return await crmClient.webhooks.create(registryTreeItem.resourceGroup, registryTreeItem.registryName, webhookName, webhookCreateParameters);
    }
}
